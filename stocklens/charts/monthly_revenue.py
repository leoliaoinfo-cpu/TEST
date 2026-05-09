"""月營收趨勢圖 — bar chart with YoY growth line."""

import io
import pandas as pd
import matplotlib.pyplot as plt

import charts  # noqa: F401 — triggers font setup


_BG = "#1e1e2e"
_GRID = "#2a2a40"
_TEXT = "#c8c8d8"
_GREEN = "#26a69a"
_RED = "#ef5350"
_GOLD = "#ffd54f"


def draw(df: pd.DataFrame, code: str, name: str) -> io.BytesIO:
    df = df.tail(18).copy().reset_index(drop=True)
    df["yoy"] = df["revenue"].pct_change(12) * 100

    fig, ax1 = plt.subplots(figsize=(13, 5))
    fig.patch.set_facecolor(_BG)
    ax1.set_facecolor(_BG)

    colors = [_GREEN if (v >= 0 or pd.isna(v)) else _RED for v in df["yoy"]]
    bars = ax1.bar(range(len(df)), df["revenue"] / 1e8, color=colors, alpha=0.85, zorder=2)

    ax1.set_ylabel("月營收（億元）", color=_TEXT, fontsize=10)
    ax1.tick_params(colors=_TEXT, labelsize=8)
    ax1.set_xticks(range(len(df)))
    ax1.set_xticklabels(df["date"].dt.strftime("%y/%m"), rotation=45, ha="right", color=_TEXT, fontsize=8)
    for sp in ax1.spines.values():
        sp.set_color(_GRID)
    ax1.grid(axis="y", color=_GRID, linestyle="--", alpha=0.6, zorder=0)

    # Revenue value labels
    for i, (bar, rev) in enumerate(zip(bars, df["revenue"])):
        if pd.notna(rev):
            ax1.text(i, bar.get_height() + max(df["revenue"].max() / 1e8 * 0.01, 0.3),
                     f"{rev/1e8:.1f}", ha="center", va="bottom", color=_TEXT, fontsize=7)

    # YoY line (right axis)
    ax2 = ax1.twinx()
    ax2.set_facecolor(_BG)
    valid = df["yoy"].dropna()
    ax2.plot(df.index, df["yoy"], color=_GOLD, linewidth=2, marker="o", markersize=4, zorder=3)
    ax2.axhline(0, color=_GOLD, linestyle="--", alpha=0.35, linewidth=1)
    ax2.set_ylabel("YoY (%)", color=_GOLD, fontsize=10)
    ax2.tick_params(colors=_GOLD, labelsize=8)
    for sp in ax2.spines.values():
        sp.set_color(_GRID)

    ax1.set_title(f"{name}（{code}）月營收趨勢", color=_TEXT, fontsize=13, pad=12)
    plt.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight", facecolor=_BG)
    plt.close(fig)
    buf.seek(0)
    return buf
