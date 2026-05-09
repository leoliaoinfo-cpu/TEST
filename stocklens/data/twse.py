"""Real-time stock quote from TWSE (TSE + OTC) public API."""

import httpx
from typing import Optional

_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"
_HEADERS = {"Referer": "https://mis.twse.com.tw/stock/fibest.html"}


def _f(v) -> Optional[float]:
    try:
        return float(v) if v and v != "-" else None
    except (ValueError, TypeError):
        return None


def _i(v) -> Optional[int]:
    try:
        return int(float(v)) if v and v != "-" else None
    except (ValueError, TypeError):
        return None


async def fetch_realtime(code: str) -> Optional[dict]:
    """
    Try TSE then OTC. Returns a normalised dict or None if not found.
    During off-hours, `price` falls back to previous close.
    """
    async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
        for ex in ("tse", "otc"):
            try:
                r = await client.get(
                    _URL,
                    params={"ex_ch": f"{ex}_{code}.tw", "json": "1", "delay": "0"},
                    headers=_HEADERS,
                )
                arr = r.json().get("msgArray", [])
                if not arr:
                    continue
                item = arr[0]
                name = item.get("n", "")
                if not name:
                    continue

                z = item.get("z", "-")   # current price (- when closed)
                y = item.get("y", "-")   # previous close
                market_open = z != "-"
                price = _f(z) if market_open else _f(y)
                prev_close = _f(y)

                change = (price - prev_close) if (price and prev_close) else None
                change_pct = (change / prev_close * 100) if (change is not None and prev_close) else None

                return {
                    "code": item.get("c", code),
                    "name": name,
                    "exchange": ex.upper(),
                    "price": price,
                    "prev_close": prev_close,
                    "open": _f(item.get("o")),
                    "high": _f(item.get("h")),
                    "low": _f(item.get("l")),
                    "volume": _i(item.get("v")),
                    "change": change,
                    "change_pct": change_pct,
                    "market_open": market_open,
                    "date": item.get("d", ""),
                    "time": item.get("t", ""),
                }
            except Exception:
                continue
    return None
