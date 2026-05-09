"""Claude API streaming analysis — updates caller every ~1.5 s."""

import asyncio
from typing import Awaitable, Callable

import anthropic
import config

_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY)
    return _client


async def stream_analysis(prompt: str, on_update: Callable[[str], Awaitable[None]]) -> str:
    """
    Stream a Claude response.
    `on_update(text)` is awaited periodically with the accumulated text so far.
    Returns the complete final text.
    """
    full = ""
    last_flush = asyncio.get_event_loop().time()
    FLUSH_INTERVAL = 1.5  # seconds between Telegram edits

    async with _get_client().messages.stream(
        model="claude-haiku-4-5-20251001",
        max_tokens=1400,
        system=(
            "你是專業的台股分析師，熟悉技術分析與基本面分析。"
            "請用繁體中文回答，語氣精簡專業，重點突出，避免贅述。"
            "不要給出明確的買入或賣出建議。"
        ),
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        async for chunk in stream.text_stream:
            full += chunk
            now = asyncio.get_event_loop().time()
            if now - last_flush >= FLUSH_INTERVAL:
                await on_update(full + " ▌")
                last_flush = now

    await on_update(full)
    return full
