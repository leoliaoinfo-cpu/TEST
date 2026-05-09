"""法人買賣 & 融資券餘額走勢圖."""

import io
from typing import Optional

import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

import charts  # noqa: F401


_BG = "#1e1e2e"
_GRID = "#2a2a40"
_TEXT = "#c8c8d8"
_GREEN = "#26a69a"
_RED = "#ef5350"
_BLUE = "#42a5f5"
_ORANGE = "#ffa726"


def draw(
    price_df: pd.DataFrame,
    inst_df: Optional[pd.DataFrame],
    margin_df: Optional[pd.DataFrame],
    code: str,
    name: str,
) -> Optional[io.BytesIO]:
    if inst_df is None and margin_df is None:
        return None

    fig, (ax_top, ax_bot) = plt.subplots(2, 1, figsize=(13, 8), height_ratios=[3, 2])
    fig.patch.set_facecolor(_BG)
    for ax in (ax_top, ax_bot):
        ax.set_facecolor(_BG)
        for sp in ax.spines.values():
            sp.set_color(_GRID)
        ax.tick_params(colors=_TEXT, labelsize=8)

    # ── Top: Stock price + net institutional bars ──────────────────────────
    price = price_df[["date", "close"]].tail(65).set_index("date").sort_index()
    ax_top.plot(price.index, price["close"], color=_TEXT, linewidth=2, zorder=5, label="股價")
    ax_top.set_ylabel("股價（元）", color=_TEXT, fontsize=10)
    ax_top.grid(color=_GRID, linestyle="--", alpha=0.3)
    ax_top.set_title(f"{name}（{code}）法人動向 & 融資券", color=_TEXT, fontsize=13, pad=10)

    if inst_df is not None and not inst_df.empty:
        inst = inst_df.copy().set_index("date").sort_index()
        net_sum = inst.groupby(level=0)["net"].sum().tail(45)
        ax_net = ax_top.twinx()
        ax_net.set_facecolor(_BG)
        for sp in ax_net.spines.values():
            sp.set_color(_GRID)
        bar_colors = [_GREEN if v >= 0 else _RED for v in net_sum]
        ax_net.bar(net_sum.index, net_sum / 1e6, color=bar_colors, alpha=0.45, zorder=2, width=0.8)
        ax_net.set_ylabel("法人合計淨買（百萬股）", color=_TEXT, fontsize=9)
        ax_net.tick_params(colors=_TEXT, labelsize=8)
        ax_net.axhline(0, color=_TEXT, linewidth=0.5, alpha=0.4)

    ax_top.xaxis.set_major_formatter(mdates.DateFormatter("%m/%d"))
    ax_top.xaxis.set_major_locator(mdates.WeekdayLocator(interval=2))
    plt.setp(ax_top.xaxis.get_majorticklabels(), rotation=45, ha="right")

    # ── Bottom: Margin balance vs short sale balance ───────────────────────
    if margin_df is not None and not margin_df.empty:
        mg = margin_df.set_index("date").sort_index().tail(45)
        has_margin = "MarginPurchaseTodayBalance" in mg.columns
        has_short = "ShortSaleTodayBalance" in mg.columns

        if has_margin:
            ax_bot.plot(
                mg.index, mg["MarginPurchaseTodayBalance"] / 1000,
                color=_BLUE, linewidth=1.8, label="融資餘額（千張）",
            )
            ax_bot.set_ylabel("融資（千張）", color=_BLUE, fontsize=9)
            ax_bot.tick_params(axis="y", colors=_BLUE)

        if has_short:
            ax_sh = ax_bot.twinx()
            ax_sh.set_facecolor(_BG)
            for sp in ax_sh.spines.values():
                sp.set_color(_GRID)
            ax_sh.plot(
                mg.index, mg["ShortSaleTodayBalance"] / 1000,
                color=_ORANGE, linewidth=1.8, label="融券餘額（千張）",
            )
            ax_sh.set_ylabel("融券（千張）", color=_ORANGE, fontsize=9)
            ax_sh.tick_params(colors=_ORANGE, labelsize=8)

        ax_bot.grid(color=_GRID, linestyle="--", alpha=0.3)
        ax_bot.xaxis.set_major_formatter(mdates.DateFormatter("%m/%d"))
        ax_bot.xaxis.set_major_locator(mdates.WeekdayLocator(interval=2))
        plt.setp(ax_bot.xaxis.get_majorticklabels(), rotation=45, ha="right")

        # Combined legend
        lines = []
        if has_margin:
            lines += ax_bot.get_lines()
        if has_short:
            lines += ax_sh.get_lines()
        if lines:
            ax_bot.legend(lines, [l.get_label() for l in lines],
                          loc="upper left", fontsize=8, facecolor=_BG, labelcolor=_TEXT)
    else:
        ax_bot.text(0.5, 0.5, "融資券資料暫無", transform=ax_bot.transAxes,
                    ha="center", va="center", color=_TEXT, fontsize=12)

    plt.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight", facecolor=_BG)
    plt.close(fig)
    buf.seek(0)
    return buf
