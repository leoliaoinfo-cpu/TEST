"""PE 河流圖 — historical price with PE band lines + PE history subplot."""

import io
from typing import Optional

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

import charts  # noqa: F401


_BG = "#1e1e2e"
_GRID = "#2a2a40"
_TEXT = "#c8c8d8"
_PRICE_LINE = "#e0e0e0"
_PE_LINE = "#ffd54f"

_PE_LEVELS = [8, 12, 16, 20, 24, 32]
_PE_COLORS = ["#26c6da", "#42a5f5", "#66bb6a", "#ffa726", "#ef5350", "#ab47bc"]


def _ttm_eps(eps_series: pd.Series) -> pd.Series:
    """Compute trailing-4-quarter EPS sum for each quarter entry."""
    result = pd.Series(index=eps_series.index, dtype=float)
    for i in range(len(eps_series)):
        n = min(i + 1, 4)
        result.iloc[i] = eps_series.iloc[max(0, i - 3): i + 1].sum() * (4 / n)
    return result


def draw(price_df: pd.DataFrame, fin_df: pd.DataFrame, code: str, name: str) -> Optional[io.BytesIO]:
    eps_df = fin_df[fin_df["type"] == "EPS"].copy().dropna(subset=["value"])
    if eps_df.empty or len(price_df) < 30:
        return None

    eps_df = eps_df.sort_values("date").set_index("date")["value"]
    ttm = _ttm_eps(eps_df)

    # Forward-fill TTM EPS to every trading day in price_df
    price = price_df[["date", "close"]].copy().set_index("date").sort_index()
    combined_idx = price.index.union(ttm.index)
    ttm_daily = ttm.reindex(combined_idx).ffill().reindex(price.index)

    valid_mask = ttm_daily.notna() & (ttm_daily > 0)
    if valid_mask.sum() < 10:
        return None

    pe_hist = (price["close"] / ttm_daily)[valid_mask]
    current_ttm = ttm_daily.dropna().iloc[-1]
    current_pe = pe_hist.iloc[-1] if not pe_hist.empty else float("nan")
    mean_pe = pe_hist.mean()

    # ── Plot ──────────────────────────────────────────────────────────────────
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(13, 7), height_ratios=[3, 1], sharex=True)
    fig.patch.set_facecolor(_BG)
    for ax in (ax1, ax2):
        ax.set_facecolor(_BG)
        for sp in ax.spines.values():
            sp.set_color(_GRID)
        ax.tick_params(colors=_TEXT, labelsize=8)

    # PE band lines (based on current TTM EPS)
    for pe_val, color in zip(_PE_LEVELS, _PE_COLORS):
        band_price = current_ttm * pe_val
        ax1.axhline(band_price, color=color, linestyle="--", linewidth=0.9, alpha=0.75)
        ax1.text(price.index[-1], band_price, f"  {pe_val}x", color=color, fontsize=8, va="center")

    ax1.plot(price.index, price["close"], color=_PRICE_LINE, linewidth=1.5, zorder=5)
    ax1.set_ylabel("股價（元）", color=_TEXT, fontsize=10)
    ax1.grid(color=_GRID, linestyle="--", alpha=0.3)
    ax1.set_title(
        f"{name}（{code}）PE 河流圖   現值 {current_pe:.1f}x  /  歷史均 {mean_pe:.1f}x",
        color=_TEXT, fontsize=12, pad=10,
    )

    # PE history
    ax2.plot(pe_hist.index, pe_hist, color=_PE_LINE, linewidth=1.5)
    ax2.axhline(mean_pe, color="#42a5f5", linestyle="--", linewidth=1, alpha=0.8)
    if not pe_hist.empty:
        ax2.text(pe_hist.index[-1], mean_pe, f"  均 {mean_pe:.1f}x", color="#42a5f5", fontsize=8, va="bottom")
        ax2.text(pe_hist.index[-1], current_pe, f"  {current_pe:.1f}x", color=_PE_LINE, fontsize=9, fontweight="bold")
    ax2.set_ylabel("本益比", color=_TEXT, fontsize=9)
    ax2.grid(color=_GRID, linestyle="--", alpha=0.3)

    ax2.xaxis.set_major_formatter(mdates.DateFormatter("%y/%m"))
    ax2.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
    plt.setp(ax2.xaxis.get_majorticklabels(), rotation=45, ha="right")

    plt.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight", facecolor=_BG)
    plt.close(fig)
    buf.seek(0)
    return buf
