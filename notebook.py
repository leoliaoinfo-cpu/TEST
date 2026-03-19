#!/usr/bin/env python3
"""
智腦記事本 (AI-Searchable Notebook)
一個可以搜尋、自我精進、不斷補足知識的 AI 記事本。

使用方式:
  python notebook.py add <標題> <內容>     # 新增筆記
  python notebook.py search <搜尋詞>       # AI 智能搜尋
  python notebook.py view <id>            # 檢視筆記
  python notebook.py list                 # 列出所有筆記
  python notebook.py augment <id>         # AI 補充筆記知識
  python notebook.py improve <id>         # AI 改善筆記品質
  python notebook.py analyze              # AI 分析知識缺口
  python notebook.py summarize <主題>     # AI 合成主題摘要
  python notebook.py autotag <id>         # AI 自動標籤
  python notebook.py delete <id>          # 刪除筆記
"""

import sqlite3
import json
import os
import sys
import argparse
import re
from datetime import datetime

import anthropic

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "notebook.db")


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def init_db() -> None:
    """Initialize the SQLite database with FTS5 full-text search support."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT    NOT NULL,
            content     TEXT    NOT NULL,
            tags        TEXT    DEFAULT '[]',
            created_at  TEXT    NOT NULL,
            updated_at  TEXT    NOT NULL
        )
    """)
    # FTS5 virtual table — enables fast full-text search
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            title,
            content,
            tags,
            content='notes',
            content_rowid='id'
        )
    """)
    # Triggers to keep FTS index up-to-date
    conn.executescript("""
        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
            INSERT INTO notes_fts(rowid, title, content, tags)
            VALUES (new.id, new.title, new.content, new.tags);
        END;

        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, content, tags)
            VALUES ('delete', old.id, old.title, old.content, old.tags);
        END;

        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, content, tags)
            VALUES ('delete', old.id, old.title, old.content, old.tags);
            INSERT INTO notes_fts(rowid, title, content, tags)
            VALUES (new.id, new.title, new.content, new.tags);
        END;
    """)
    conn.commit()
    conn.close()


def get_note(note_id: int) -> dict | None:
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT id, title, content, tags, created_at, updated_at FROM notes WHERE id = ?",
        (note_id,)
    ).fetchone()
    conn.close()
    if not row:
        return None
    return dict(zip(["id", "title", "content", "tags", "created_at", "updated_at"], row))


def fts_search(query: str, limit: int = 20) -> list[dict]:
    """Full-text search using FTS5; falls back to LIKE if query syntax is invalid."""
    conn = sqlite3.connect(DB_PATH)
    try:
        rows = conn.execute("""
            SELECT n.id, n.title, n.content, n.tags, n.created_at,
                   snippet(notes_fts, 1, '>>>', '<<<', '...', 30) AS snippet
            FROM notes_fts
            JOIN notes n ON n.id = notes_fts.rowid
            WHERE notes_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        """, (query, limit)).fetchall()
    except Exception:
        like = f"%{query}%"
        rows = conn.execute("""
            SELECT id, title, content, tags, created_at,
                   SUBSTR(content, 1, 200) AS snippet
            FROM notes
            WHERE title LIKE ? OR content LIKE ?
            LIMIT ?
        """, (like, like, limit)).fetchall()
    conn.close()
    return [dict(zip(["id", "title", "content", "tags", "created_at", "snippet"], r)) for r in rows]


def all_notes() -> list[dict]:
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT id, title, content, tags, created_at, updated_at FROM notes ORDER BY updated_at DESC"
    ).fetchall()
    conn.close()
    return [dict(zip(["id", "title", "content", "tags", "created_at", "updated_at"], r)) for r in rows]


def save_note(title: str, content: str, tags: list[str] | None = None) -> int:
    now = datetime.now().isoformat()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.execute(
        "INSERT INTO notes (title, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (title, content, json.dumps(tags or []), now, now)
    )
    nid = cur.lastrowid
    conn.commit()
    conn.close()
    return nid


def update_note(note_id: int, content: str = None, tags: list[str] = None) -> None:
    conn = sqlite3.connect(DB_PATH)
    now = datetime.now().isoformat()
    if content is not None and tags is not None:
        conn.execute(
            "UPDATE notes SET content = ?, tags = ?, updated_at = ? WHERE id = ?",
            (content, json.dumps(tags), now, note_id)
        )
    elif content is not None:
        conn.execute(
            "UPDATE notes SET content = ?, updated_at = ? WHERE id = ?",
            (content, now, note_id)
        )
    elif tags is not None:
        conn.execute(
            "UPDATE notes SET tags = ?, updated_at = ? WHERE id = ?",
            (json.dumps(tags), now, note_id)
        )
    conn.commit()
    conn.close()


def delete_note(note_id: int) -> bool:
    conn = sqlite3.connect(DB_PATH)
    affected = conn.execute("DELETE FROM notes WHERE id = ?", (note_id,)).rowcount
    conn.commit()
    conn.close()
    return affected > 0


# ---------------------------------------------------------------------------
# AI client
# ---------------------------------------------------------------------------

def get_client() -> anthropic.Anthropic:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("錯誤：請設定環境變數 ANTHROPIC_API_KEY", file=sys.stderr)
        print("  export ANTHROPIC_API_KEY='your-api-key'", file=sys.stderr)
        sys.exit(1)
    return anthropic.Anthropic(api_key=api_key)


def stream_response(client: anthropic.Anthropic, prompt: str, use_thinking: bool = False) -> str:
    """Stream a Claude response and return the complete text."""
    kwargs: dict = {
        "model": "claude-opus-4-6",
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": prompt}],
    }
    if use_thinking:
        kwargs["thinking"] = {"type": "adaptive"}

    full_text = ""
    with client.messages.stream(**kwargs) as stream:
        for text in stream.text_stream:
            print(text, end="", flush=True)
            full_text += text
    print()
    return full_text


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_add(args) -> None:
    """Add a new note."""
    note_id = save_note(args.title, args.content, args.tags)
    print(f"✓ 已新增筆記 #{note_id}：{args.title}")

    if not args.no_autotag:
        print("  → AI 自動標籤中...")
        try:
            _autotag(note_id, args.title, args.content)
        except Exception as e:
            print(f"  (自動標籤失敗：{e})")


def cmd_search(args) -> None:
    """Search notes with AI semantic ranking."""
    results = fts_search(args.query)

    if not results:
        # No FTS match → send all note titles to AI for semantic search
        notes = all_notes()
        if not notes:
            print("記事本是空的，請先新增筆記。")
            return
        results = notes

    client = get_client()
    notes_overview = "\n".join(
        f"ID {r['id']}: {r['title']} — {r['content'][:120]}..."
        for r in results
    )

    prompt = f"""你是一個智能筆記搜尋助手。用戶的搜尋關鍵字是：「{args.query}」

以下是資料庫中的筆記：
{notes_overview}

請根據語意相關性排列筆記，並說明每篇筆記與搜尋詞的關聯。
- 先列出最相關的 5 篇（格式：ID x — 原因）
- 最後給一句話搜尋摘要
- 若都不相關，請如實說明"""

    print(f"\n🔍 搜尋：「{args.query}」\n")
    print("─" * 50)
    stream_response(client, prompt)
    print("─" * 50)
    print("\n符合的筆記：")
    for r in results[:5]:
        tags = json.loads(r["tags"]) if r.get("tags") else []
        tag_str = f"  🏷  {', '.join(tags)}" if tags else ""
        print(f"  #{r['id']} [{r['title']}]{tag_str}")
        snippet = r.get("snippet") or r.get("content", "")
        print(f"     {snippet[:100]}...")
        print()


def cmd_view(args) -> None:
    """View a specific note."""
    note = get_note(args.id)
    if not note:
        print(f"找不到筆記 #{args.id}")
        return
    tags = json.loads(note["tags"]) if note["tags"] else []
    print(f"\n{'='*60}")
    print(f"#{note['id']}  {note['title']}")
    print(f"{'='*60}")
    if tags:
        print(f"🏷  {', '.join(tags)}")
    print(f"建立：{note['created_at'][:19]}   更新：{note['updated_at'][:19]}")
    print(f"{'─'*60}")
    print(note["content"])
    print()


def cmd_list(args) -> None:
    """List all notes."""
    notes = all_notes()
    if not notes:
        print("記事本是空的。使用 'add <標題> <內容>' 來新增第一篇筆記。")
        return
    print(f"\n{'#':<6} {'標題':<35} {'標籤':<20} {'更新日期'}")
    print("─" * 75)
    for n in notes:
        tags = json.loads(n["tags"]) if n["tags"] else []
        tag_str = ", ".join(tags[:3]) if tags else "—"
        date_str = n["updated_at"][:10]
        print(f"{n['id']:<6} {n['title'][:33]:<35} {tag_str[:18]:<20} {date_str}")
    print(f"\n共 {len(notes)} 篇筆記。")


def cmd_augment(args) -> None:
    """Use AI to supplement a note with additional knowledge."""
    note = get_note(args.id)
    if not note:
        print(f"找不到筆記 #{args.id}")
        return

    client = get_client()
    prompt = f"""你是一個知識補充系統。請根據以下筆記的主題，補充更多相關知識：

**筆記標題**：{note['title']}
**筆記內容**：
{note['content']}

請補充：
1. 相關概念與延伸說明
2. 可能遺漏的重要細節
3. 實際應用範例或使用場景
4. 與其他相關主題的連結
5. 值得深入了解的延伸資源或方向

請以流暢、有結構的方式撰寫補充內容（使用與筆記相同的語言）。"""

    print(f"\n🤖 AI 正在補充筆記：{note['title']}\n")
    print("─" * 50)
    supplement = stream_response(client, prompt, use_thinking=True)
    print("─" * 50)

    print("\n將補充內容儲存至筆記？(y/n)：", end="")
    if input().strip().lower() == "y":
        new_content = note["content"] + "\n\n---\n**🤖 AI 補充知識：**\n\n" + supplement
        update_note(args.id, content=new_content)
        print(f"✓ 筆記 #{args.id} 已補充更新。")


def cmd_improve(args) -> None:
    """Use AI to improve/rewrite a note."""
    note = get_note(args.id)
    if not note:
        print(f"找不到筆記 #{args.id}")
        return

    client = get_client()
    prompt = f"""請改善以下筆記的品質，包括：
1. 改善清晰度與可讀性
2. 加入更好的結構（標題、條列式）
3. 修正任何不精確或過時的說法
4. 保留所有重要資訊，並使整體更簡潔有力

**標題**：{note['title']}
**原始內容**：
{note['content']}

請直接輸出改善後的筆記內容（使用與原文相同的語言），不需要額外說明。"""

    print(f"\n✨ AI 正在改善筆記：{note['title']}\n")
    print("─" * 50)
    improved = stream_response(client, prompt)
    print("─" * 50)

    print("\n以改善後版本取代原始筆記？(y/n)：", end="")
    if input().strip().lower() == "y":
        update_note(args.id, content=improved)
        print(f"✓ 筆記 #{args.id} 已改善並儲存。")


def cmd_analyze(args) -> None:
    """Analyze the knowledge base for gaps and improvement opportunities."""
    notes = all_notes()
    if not notes:
        print("記事本是空的，請先新增筆記。")
        return

    client = get_client()
    overview = "\n".join(
        f"#{n['id']}: {n['title']} | 標籤: {', '.join(json.loads(n['tags'])) or '無'}"
        for n in notes
    )

    prompt = f"""你是一位知識管理顧問。請分析以下記事本的知識結構：

**目前的筆記：**
{overview}

請提供：
1. **知識缺口分析**：哪些重要主題或關聯性缺失？
2. **建議新增筆記**：具體建議 3-5 個應該新增的主題
3. **知識連結地圖**：現有筆記彼此之間的關聯性
4. **優先改善建議**：哪 2-3 篇筆記最需要擴充或改善？

請給出具體且可執行的建議。"""

    print(f"\n🔬 AI 正在分析知識庫（共 {len(notes)} 篇筆記）...\n")
    print("─" * 50)
    stream_response(client, prompt, use_thinking=True)
    print("─" * 50)


def cmd_summarize(args) -> None:
    """Synthesize knowledge on a topic from multiple notes."""
    results = fts_search(args.topic, limit=10)
    if not results:
        print(f"找不到與「{args.topic}」相關的筆記。")
        return

    client = get_client()
    notes_content = "\n\n---\n\n".join(
        f"**#{r['id']} {r['title']}**\n{r['content']}"
        for r in results
    )

    prompt = f"""請根據以下筆記，針對主題「{args.topic}」合成一份全面的知識摘要：

{notes_content}

請包含：
1. 主題核心概念的清晰摘要
2. 整合各筆記的關鍵洞見
3. 不同觀點或方法的對比
4. 知識的實際應用
5. 尚待補充的知識空白

格式要清晰有層次。"""

    print(f"\n📚 AI 正在合成「{args.topic}」的知識摘要（來源 {len(results)} 篇筆記）...\n")
    print("─" * 50)
    stream_response(client, prompt)
    print("─" * 50)


def cmd_autotag(args) -> None:
    """Auto-tag a note using AI."""
    note = get_note(args.id)
    if not note:
        print(f"找不到筆記 #{args.id}")
        return
    tags = _autotag(args.id, note["title"], note["content"])
    if tags:
        print(f"✓ 已為筆記 #{args.id} 加入標籤：{', '.join(tags)}")


def _autotag(note_id: int, title: str, content: str) -> list[str]:
    """Internal: generate and save AI tags for a note."""
    client = get_client()
    prompt = f"""為以下筆記產生 3-7 個相關標籤。只輸出 JSON 陣列，不要其他文字。
範例：["python", "程式設計", "教學"]

標題：{title}
內容：{content[:400]}"""

    response = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=150,
        messages=[{"role": "user", "content": prompt}]
    )
    text = response.content[0].text.strip()
    match = re.search(r"\[.*?\]", text, re.DOTALL)
    if match:
        try:
            tags = json.loads(match.group())
            update_note(note_id, tags=tags)
            return tags
        except json.JSONDecodeError:
            pass
    return []


def cmd_delete(args) -> None:
    """Delete a note."""
    note = get_note(args.id)
    if not note:
        print(f"找不到筆記 #{args.id}")
        return
    print(f"確定刪除筆記 #{args.id}「{note['title']}」？(y/n)：", end="")
    if input().strip().lower() == "y":
        delete_note(args.id)
        print(f"✓ 筆記 #{args.id} 已刪除。")
    else:
        print("取消刪除。")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    init_db()

    parser = argparse.ArgumentParser(
        prog="notebook",
        description="🧠 智腦記事本 — 可搜尋、自我精進的 AI 記事本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
指令說明：
  add <標題> <內容>    新增筆記（自動 AI 標籤）
  search <搜尋詞>      AI 語意搜尋
  view <id>           檢視筆記
  list                列出所有筆記
  augment <id>        AI 補充知識至筆記
  improve <id>        AI 改善筆記品質
  analyze             AI 分析知識缺口
  summarize <主題>    AI 合成主題知識摘要
  autotag <id>        AI 自動為筆記加標籤
  delete <id>         刪除筆記

環境變數：
  ANTHROPIC_API_KEY   必須設定 Claude API 金鑰
        """,
    )
    sub = parser.add_subparsers(dest="command", metavar="<指令>")

    # add
    p = sub.add_parser("add", help="新增筆記")
    p.add_argument("title", help="筆記標題")
    p.add_argument("content", help="筆記內容")
    p.add_argument("--tags", nargs="+", help="手動標籤（可省略，AI 會自動產生）")
    p.add_argument("--no-autotag", action="store_true", help="跳過 AI 自動標籤")

    # search
    p = sub.add_parser("search", help="AI 語意搜尋筆記")
    p.add_argument("query", help="搜尋關鍵字或問題")

    # view
    p = sub.add_parser("view", help="檢視筆記")
    p.add_argument("id", type=int, help="筆記 ID")

    # list
    sub.add_parser("list", help="列出所有筆記")

    # augment
    p = sub.add_parser("augment", help="AI 補充知識")
    p.add_argument("id", type=int, help="筆記 ID")

    # improve
    p = sub.add_parser("improve", help="AI 改善筆記")
    p.add_argument("id", type=int, help="筆記 ID")

    # analyze
    sub.add_parser("analyze", help="AI 分析知識缺口")

    # summarize
    p = sub.add_parser("summarize", help="AI 合成主題摘要")
    p.add_argument("topic", help="要摘要的主題")

    # autotag
    p = sub.add_parser("autotag", help="AI 自動標籤")
    p.add_argument("id", type=int, help="筆記 ID")

    # delete
    p = sub.add_parser("delete", help="刪除筆記")
    p.add_argument("id", type=int, help="筆記 ID")

    args = parser.parse_args()

    dispatch = {
        "add": cmd_add,
        "search": cmd_search,
        "view": cmd_view,
        "list": cmd_list,
        "augment": cmd_augment,
        "improve": cmd_improve,
        "analyze": cmd_analyze,
        "summarize": cmd_summarize,
        "autotag": cmd_autotag,
        "delete": cmd_delete,
    }

    if args.command in dispatch:
        dispatch[args.command](args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
