import os
from dotenv import load_dotenv

load_dotenv()

TELEGRAM_BOT_TOKEN: str = os.environ["TELEGRAM_BOT_TOKEN"]
WEBHOOK_URL: str = os.environ["WEBHOOK_URL"]          # e.g. https://stocklens.onrender.com
WEBHOOK_SECRET: str = os.environ.get("WEBHOOK_SECRET", "stocklens_secret_change_me")
ANTHROPIC_API_KEY: str = os.environ["ANTHROPIC_API_KEY"]
FINMIND_TOKEN: str = os.environ.get("FINMIND_TOKEN", "")  # optional, raises rate limit
