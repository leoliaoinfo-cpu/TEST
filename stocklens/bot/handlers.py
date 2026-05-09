"""Telegram command & message handlers."""

import asyncio
import io
import logging
from typing import Optional

from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import CommandHandler, ContextTypes, MessageHandler, filters

import data.finmind as finmind
import data.twse as twse
import data.indicators as ind
import charts.monthly_revenue as chart_rev
import charts.pe_river as chart_pe
import charts.institutional as chart_inst
import analyst.claude_stream as analyst

log = logging.getLogger(__name__)

_HELP = (
    "📊 *StockLens 股析機器人*\n\n"
    "直接輸入股票代號（4-6位數字）或：\n"
    "`/分析 2330` — 完整AI分析報告\n"
    "`/a 2330` — 同上（縮寫）\n"
    "`/p 2330` — 僅查即時股價\n\n"
    "支援台股上市（TSE）與上櫃（OTC）。"
)


# ─── helpers ──────────────────────────────────────────────────────────────────

def _arrow(change: Optional[float]) -> str:
    return "▲" if (change or 0) >= 0 else "▼"


def _color(change: Optional[float]) -> str:
    return "🟢" if (change or 0) >= 0 else "🔴"


def _fmt(v, decimals: int = 2) -> str:
    return f"{v:.{decimals}f}" if v is not None else "N/A"


# ─── /start ───────────────────────────────────────────────────────────────────

async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(_HELP, parse_mode=ParseMode.MARKDOWN)


# ─── /p <code> — price only ───────────────────────────────────────────────────

async def price_only(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    code = " ".join(ctx.args).strip() if ctx.args else ""
    if not code:
        await update.message.reply_text("用法：`/p 2330`", parse_mode=ParseMode.MARKDOWN)
        return

    msg = await update.message.reply_text(f"⏳ 查詢 {code} 中…")
    info = await twse.fetch_realtime(code)

    if not info:
        await msg.edit_text(f"❌ 找不到股票代號 `{code}`，請確認後再試。",
                            parse_mode=ParseMode.MARKDOWN)
        return

    status = "盤中" if info["market_open"] else "收盤"
    change = info.get("change")
    change_pct = info.get("change_pct")
    text = (
        f"{_color(change)} *{info['name']}*（{info['code']} · {info['exchange']}）\n"
        f"─────────────────\n"
        f"股價：`{_fmt(info['price'])}` 元　{status}\n"
        f"漲跌：{_arrow(change)} `{abs(change or 0):.2f}` ({change_pct:+.2f}%)\n"
        f"開／高／低：{_fmt(info['open'])} / {_fmt(info['high'])} / {_fmt(info['low'])}\n"
        f"成交量：{(info['volume'] or 0):,} 張\n"
        f"時間：{info['date']} {info['time']}"
    )
    await msg.edit_text(text, parse_mode=ParseMode.MARKDOWN)


# ─── /分析 <code> — full analysis ─────────────────────────────────────────────

async def analyze(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    raw = " ".join(ctx.args).strip() if ctx.args else ""
    if not raw:
        await update.message.reply_text("請輸入股票代號，例如：`/分析 2330`",
                                        parse_mode=ParseMode.MARKDOWN)
        return

    code = raw.strip().upper()
    status_msg = await update.message.reply_text(f"⏳ 正在抓取 `{code}` 資料，請稍候…",
                                                  parse_mode=ParseMode.MARKDOWN)

    # ── Fetch all data sources concurrently ───────────────────────────────
    results = await asyncio.gather(
        twse.fetch_realtime(code),
        finmind.price_history(code, days=400),
        finmind.monthly_revenue(code, months=20),
        finmind.institutional(code, days=65),
        finmind.margin(code, days=65),
        finmind.financials(code, years=6),
        return_exceptions=True,
    )

    def _safe(r):
        return None if isinstance(r, Exception) else r

    realtime, price_df, rev_df, inst_df, margin_df, fin_df = [_safe(r) for r in results]

    no_price = price_df is None or price_df.empty
    if realtime is None and no_price:
        await status_msg.edit_text(f"❌ 找不到股票代號 `{code}`，請確認是否正確。",
                                   parse_mode=ParseMode.MARKDOWN)
        return

    name = realtime["name"] if realtime else code
    cur_price = (realtime["price"] if realtime
                 else (price_df["close"].iloc[-1] if not no_price else None))
    change = realtime.get("change") if realtime else None
    change_pct = realtime.get("change_pct") if realtime else None
    market_open = realtime.get("market_open", False) if realtime else False

    await status_msg.edit_text(
        f"📊 *{name}*（{code}）分析中，請稍候…", parse_mode=ParseMode.MARKDOWN
    )

    # ── Technical indicators ───────────────────────────────────────────────
    ind_df = None
    sigs: dict = {}
    if not no_price and len(price_df) >= 20:
        ind_df = ind.add_indicators(price_df)
        sigs = ind.signals(ind_df)

    # ── Generate charts in thread pool (matplotlib is not async) ──────────
    loop = asyncio.get_running_loop()

    async def _chart(fn, *args):
        try:
            return await loop.run_in_executor(None, fn, *args)
        except Exception as e:
            log.warning("Chart error %s: %s", fn.__name__, e)
            return None

    rev_chart, pe_chart, inst_chart = await asyncio.gather(
        _chart(chart_rev.draw, rev_df, code, name) if (rev_df is not None and not rev_df.empty) else asyncio.sleep(0, result=None),
        _chart(chart_pe.draw, price_df, fin_df, code, name) if (not no_price and fin_df is not None and not fin_df.empty) else asyncio.sleep(0, result=None),
        _chart(chart_inst.draw, price_df, inst_df, margin_df, code, name) if (not no_price and (inst_df is not None or margin_df is not None)) else asyncio.sleep(0, result=None),
    )

    # ── Price + indicators summary ─────────────────────────────────────────
    status_label = "盤中 🟢" if market_open else "收盤"
    summary_lines = [
        f"{_color(change)} *{name}*（{code} · {realtime['exchange'] if realtime else ''}）",
        "─────────────────",
        f"股價：`{_fmt(cur_price)}` 元　{status_label}",
    ]
    if change is not None:
        summary_lines.append(f"漲跌：{_arrow(change)} `{abs(change):.2f}` ({change_pct:+.2f}%)")
    if realtime:
        summary_lines.append(
            f"開／高／低：{_fmt(realtime['open'])} / {_fmt(realtime['high'])} / {_fmt(realtime['low'])}"
        )
        summary_lines.append(f"成交量：{(realtime['volume'] or 0):,} 張")

    if sigs:
        summary_lines.append("─────────────────")
        summary_lines.append("*技術指標*")
        for key in ("trend", "rsi", "macd", "bb"):
            if key in sigs:
                summary_lines.append(f"• {sigs[key]}")
        ma_parts = [sigs[k] for k in ("ma5", "ma20", "ma60") if k in sigs]
        if ma_parts:
            summary_lines.append("• " + "　".join(ma_parts))

    await status_msg.edit_text("\n".join(summary_lines), parse_mode=ParseMode.MARKDOWN)

    # ── Send charts ────────────────────────────────────────────────────────
    chat_id = update.effective_chat.id

    async def _send_photo(buf: Optional[io.BytesIO], caption: str) -> None:
        if buf is None:
            return
        buf.seek(0)
        try:
            await update.message.reply_photo(buf, caption=caption)
        except Exception as e:
            log.warning("send_photo failed: %s", e)

    await asyncio.gather(
        _send_photo(rev_chart, f"📊 {name} 月營收趨勢"),
        _send_photo(pe_chart,  f"📈 {name} PE 河流圖"),
        _send_photo(inst_chart, f"🏦 {name} 法人 & 融資券"),
    )

    # ── Claude streaming analysis ──────────────────────────────────────────
    prompt = _build_prompt(code, name, realtime, sigs, rev_df, fin_df, inst_df, margin_df)
    ai_msg = await update.message.reply_text("🤖 AI 分析生成中…\n▌")

    async def on_update(text: str) -> None:
        try:
            await ai_msg.edit_text(text, parse_mode=ParseMode.MARKDOWN)
        except Exception:
            try:
                await ai_msg.edit_text(text)  # fallback: plain text
            except Exception:
                pass

    try:
        await analyst.stream_analysis(prompt, on_update)
    except Exception as e:
        log.error("Claude streaming error: %s", e)
        await ai_msg.edit_text("⚠️ AI 分析暫時無法使用，請稍後再試。")


# ─── plain text: treat 4-6 digit input as stock code ─────────────────────────

async def text_handler(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    text = (update.message.text or "").strip()
    if text.isdigit() and 4 <= len(text) <= 6:
        ctx.args = [text]
        await analyze(update, ctx)
    else:
        await update.message.reply_text(
            "請輸入股票代號（如 `2330`），或使用 /分析 2330",
            parse_mode=ParseMode.MARKDOWN,
        )


# ─── prompt builder ───────────────────────────────────────────────────────────

def _build_prompt(code, name, realtime, sigs, rev_df, fin_df, inst_df, margin_df) -> str:
    price = realtime["price"] if realtime else "N/A"
    change_pct = f"{realtime['change_pct']:+.2f}%" if realtime and realtime.get("change_pct") is not None else "N/A"

    # Monthly revenue
    rev_summary = "無資料"
    if rev_df is not None and len(rev_df) >= 2:
        latest = rev_df.iloc[-1]["revenue"]
        try:
            idx = rev_df[rev_df["date"].dt.month == rev_df.iloc[-1]["date"].month]
            yoy_row = idx.iloc[-2] if len(idx) >= 2 else None
            if yoy_row is not None and yoy_row["revenue"]:
                yoy = (latest - yoy_row["revenue"]) / yoy_row["revenue"] * 100
                rev_summary = f"最新月營收 {latest/1e8:.2f} 億元，YoY {yoy:+.1f}%"
            else:
                rev_summary = f"最新月營收 {latest/1e8:.2f} 億元"
        except Exception:
            rev_summary = f"最新月營收 {latest/1e8:.2f} 億元"

    # TTM PE
    pe_summary = "無資料"
    if fin_df is not None and not fin_df.empty and realtime and realtime.get("price"):
        eps_df = fin_df[fin_df["type"] == "EPS"].sort_values("date")
        if len(eps_df) >= 4:
            ttm = eps_df["value"].tail(4).sum()
            if ttm > 0:
                pe = realtime["price"] / ttm
                pe_summary = f"TTM EPS {ttm:.2f} 元，本益比 {pe:.1f}x"

    # Institutional 5-day net
    inst_summary = "無資料"
    if inst_df is not None and not inst_df.empty:
        net5 = inst_df.tail(25).groupby("date")["net"].sum().tail(5).sum()
        inst_summary = f"近5日法人合計 {net5/1e6:+.1f} 百萬股"

    # Margin trend
    margin_summary = "無資料"
    if margin_df is not None and not margin_df.empty and "MarginPurchaseTodayBalance" in margin_df.columns:
        mg = margin_df.sort_values("date")
        cur = mg["MarginPurchaseTodayBalance"].iloc[-1]
        prev = mg["MarginPurchaseTodayBalance"].iloc[max(0, len(mg) - 6)]
        chg = (cur - prev) / max(abs(prev), 1) * 100
        margin_summary = f"融資餘額 {cur/1000:.0f} 千張，近5日 {chg:+.1f}%"

    tech_summary = "、".join(v for k, v in sigs.items() if k in ("trend", "rsi", "macd", "bb")) or "無資料"

    return f"""請分析以下台股數據，用繁體中文提供投資參考。格式嚴格如下（使用 Markdown 粗體標題）：

**📊 公司概況**
（2-3句簡介 {name} 主要業務與市場地位）

**📈 技術面分析**
（根據指標說明短中期走勢）

**💰 基本面觀察**
（月營收趨勢 + 估值水位評析）

**🏦 籌碼面動向**
（法人態度 + 融資槓桿狀況）

**⚠️ 主要風險**
（列出2-3個具體風險點）

**🎯 綜合評估**
（50字以內客觀總結，不給明確買賣建議）

---
股票：{code} {name}
現價：{price} 元 （今日 {change_pct}）
技術指標：{tech_summary}
月營收：{rev_summary}
估值：{pe_summary}
法人：{inst_summary}
融資：{margin_summary}
"""


# ─── registration ─────────────────────────────────────────────────────────────

def setup_handlers(app) -> None:
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler(["分析", "a", "analyze"], analyze))
    app.add_handler(CommandHandler("p", price_only))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))
