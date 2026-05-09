"""FastAPI + python-telegram-bot v20 webhook entry point."""

import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request, Response
from telegram import Update
from telegram.ext import Application

import config
from bot.handlers import setup_handlers

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)
log = logging.getLogger(__name__)

# Build PTB application once at module level
ptb = Application.builder().token(config.TELEGRAM_BOT_TOKEN).build()
setup_handlers(ptb)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ptb.initialize()
    webhook_url = f"{config.WEBHOOK_URL.rstrip('/')}/webhook"
    await ptb.bot.set_webhook(url=webhook_url, secret_token=config.WEBHOOK_SECRET)
    log.info("Webhook set → %s", webhook_url)
    await ptb.start()
    yield
    await ptb.stop()
    await ptb.shutdown()


app = FastAPI(lifespan=lifespan)


@app.post("/webhook")
async def webhook(request: Request) -> Response:
    if request.headers.get("X-Telegram-Bot-Api-Secret-Token") != config.WEBHOOK_SECRET:
        return Response(status_code=403)
    data = await request.json()
    update = Update.de_json(data, ptb.bot)
    await ptb.process_update(update)
    return Response(status_code=200)


@app.get("/health")
async def health():
    """Keep-alive endpoint — ping this every 14 min via UptimeRobot."""
    return {"status": "ok", "service": "StockLens"}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
