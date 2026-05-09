"""Gemini API streaming analysis — completely free tier, no credit card needed."""

import asyncio
from typing import Awaitable, Callable

from google import genai
from google.genai import types
import config

_client: genai.Client | None = None

_SYSTEM = (
    "你是專業的台股分析師，熟悉技術分析與基本面分析。"
    "請用繁體中文回答，語氣精簡專業，重點突出，避免贅述。"
    "不要給出明確的買入或賣出建議。"
)


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=config.GOOGLE_API_KEY)
    return _client


async def stream_analysis(prompt: str, on_update: Callable[[str], Awaitable[None]]) -> str:
    """
    Stream a Gemini response.
    `on_update(text)` is awaited periodically with the accumulated text so far.
    Returns the complete final text.
    """
    full = ""
    last_flush = asyncio.get_running_loop().time()
    FLUSH_INTERVAL = 1.5

    async for chunk in await _get_client().aio.models.generate_content_stream(
        model="gemini-2.0-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=_SYSTEM,
            max_output_tokens=1400,
        ),
    ):
        if chunk.text:
            full += chunk.text
            now = asyncio.get_running_loop().time()
            if now - last_flush >= FLUSH_INTERVAL:
                await on_update(full + " ▌")
                last_flush = now

    await on_update(full)
    return full
