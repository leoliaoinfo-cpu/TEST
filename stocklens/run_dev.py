"""Local development runner — uses polling instead of webhook."""

import logging
from telegram.ext import Application
import config
from bot.handlers import setup_handlers

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)

if __name__ == "__main__":
    app = Application.builder().token(config.TELEGRAM_BOT_TOKEN).build()
    setup_handlers(app)
    print("Bot 啟動中（polling 模式）... 按 Ctrl+C 停止")
    app.run_polling(drop_pending_updates=True)
