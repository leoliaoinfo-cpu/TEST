"""FinMind API wrapper — free tier, cached to minimise daily request count."""

import httpx
import pandas as pd
from datetime import date, timedelta
from typing import Optional

import config
from cache import cache

_BASE = "https://api.finmindtrade.com/api/v4/data"


def _start(days: int) -> str:
    return (date.today() - timedelta(days=days)).isoformat()


async def _get(dataset: str, data_id: str, start: str, ttl: int = 1800) -> Optional[pd.DataFrame]:
    key = f"{dataset}|{data_id}|{start}"
    hit = cache.get(key, ttl)
    if hit is not None:
        return hit

    params: dict = {"dataset": dataset, "data_id": data_id, "start_date": start}
    if config.FINMIND_TOKEN:
        params["token"] = config.FINMIND_TOKEN

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(_BASE, params=params)
            j = r.json()
        rows = j.get("data") or []
        if not rows:
            return None
        df = pd.DataFrame(rows)
        cache.set(key, df)
        return df
    except Exception:
        return None


async def price_history(code: str, days: int = 400) -> Optional[pd.DataFrame]:
    df = await _get("TaiwanStockPrice", code, _start(days))
    if df is None:
        return None
    df = df.rename(columns={"max": "high", "min": "low", "Trading_Volume": "volume"})
    df["date"] = pd.to_datetime(df["date"])
    for col in ("open", "high", "low", "close", "volume"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.sort_values("date").reset_index(drop=True)


async def monthly_revenue(code: str, months: int = 20) -> Optional[pd.DataFrame]:
    df = await _get("TaiwanStockMonthRevenue", code, _start(months * 35))
    if df is None:
        return None
    df["date"] = pd.to_datetime(df["date"])
    df["revenue"] = pd.to_numeric(df["revenue"], errors="coerce")
    return df.sort_values("date").reset_index(drop=True)


async def institutional(code: str, days: int = 65) -> Optional[pd.DataFrame]:
    df = await _get("TaiwanStockInstitutionalInvestors", code, _start(days))
    if df is None:
        return None
    df["date"] = pd.to_datetime(df["date"])
    for col in ("buy", "sell", "net"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.sort_values("date").reset_index(drop=True)


async def margin(code: str, days: int = 65) -> Optional[pd.DataFrame]:
    df = await _get("TaiwanStockMarginPurchaseShortSale", code, _start(days))
    if df is None:
        return None
    df["date"] = pd.to_datetime(df["date"])
    for col in ("MarginPurchaseTodayBalance", "ShortSaleTodayBalance",
                "MarginPurchaseBuy", "MarginPurchaseSell"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.sort_values("date").reset_index(drop=True)


async def financials(code: str, years: int = 6) -> Optional[pd.DataFrame]:
    df = await _get("TaiwanStockFinancialStatements", code, _start(years * 365))
    if df is None:
        return None
    df["date"] = pd.to_datetime(df["date"])
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df.sort_values("date").reset_index(drop=True)
