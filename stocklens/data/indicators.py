"""Technical indicator calculations (pure pandas/numpy, no extra libs)."""

import numpy as np
import pandas as pd


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy().sort_values("date").reset_index(drop=True)
    c = df["close"]

    for w in (5, 10, 20, 60):
        df[f"ma{w}"] = c.rolling(w).mean()

    # RSI-14
    delta = c.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    df["rsi"] = 100 - (100 / (1 + gain / loss.replace(0, np.nan)))

    # MACD (12/26/9)
    ema12 = c.ewm(span=12, adjust=False).mean()
    ema26 = c.ewm(span=26, adjust=False).mean()
    df["macd"] = ema12 - ema26
    df["macd_signal"] = df["macd"].ewm(span=9, adjust=False).mean()
    df["macd_hist"] = df["macd"] - df["macd_signal"]

    # Bollinger Bands (20, ±2σ)
    df["bb_mid"] = c.rolling(20).mean()
    std = c.rolling(20).std()
    df["bb_up"] = df["bb_mid"] + 2 * std
    df["bb_dn"] = df["bb_mid"] - 2 * std

    return df


def signals(df: pd.DataFrame) -> dict:
    if df.empty or len(df) < 2:
        return {}
    r = df.iloc[-1]
    p = df.iloc[-2]
    close = r["close"]

    def _v(col):
        return r.get(col, float("nan"))

    # Trend (MA alignment)
    ma20, ma60 = _v("ma20"), _v("ma60")
    if pd.notna(ma20) and pd.notna(ma60):
        if close > ma20 > ma60:
            trend = "多頭排列 ↑"
        elif close < ma20 < ma60:
            trend = "空頭排列 ↓"
        else:
            trend = "盤整整理 →"
    else:
        trend = "均線資料不足"

    # RSI
    rsi = _v("rsi")
    if pd.notna(rsi):
        if rsi >= 70:
            rsi_s = f"RSI {rsi:.1f}（超買）"
        elif rsi <= 30:
            rsi_s = f"RSI {rsi:.1f}（超賣）"
        else:
            rsi_s = f"RSI {rsi:.1f}（正常）"
    else:
        rsi_s = "RSI N/A"

    # MACD
    hist, prev_hist = _v("macd_hist"), p.get("macd_hist", float("nan"))
    if pd.notna(hist) and pd.notna(prev_hist):
        if hist > 0 and prev_hist <= 0:
            macd_s = "MACD 黃金交叉 🟢"
        elif hist < 0 and prev_hist >= 0:
            macd_s = "MACD 死亡交叉 🔴"
        elif hist > 0:
            macd_s = "MACD 偏多"
        else:
            macd_s = "MACD 偏空"
    else:
        macd_s = "MACD N/A"

    # Bollinger
    bb_up, bb_dn = _v("bb_up"), _v("bb_dn")
    if pd.notna(bb_up) and pd.notna(bb_dn):
        if close > bb_up:
            bb_s = "突破布林上軌（強勢）"
        elif close < bb_dn:
            bb_s = "跌破布林下軌（弱勢）"
        else:
            bb_s = "布林通道內"
    else:
        bb_s = "布林 N/A"

    result = {"trend": trend, "rsi": rsi_s, "macd": macd_s, "bb": bb_s}
    for w in (5, 20, 60):
        v = _v(f"ma{w}")
        if pd.notna(v):
            result[f"ma{w}"] = f"MA{w}: {v:.2f}"
    return result
