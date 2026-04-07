#!/usr/bin/env python3
"""
智腦記事本 — 網頁介面 (Google GenAI + ChromaDB 版)
使用方式：python app.py → 瀏覽器開啟 http://localhost:5000

需要環境變數：GOOGLE_API_KEY
（可在專案目錄建立 .env 檔案自動載入）
"""

from flask import Flask, request, jsonify, render_template, Response, stream_with_context
import sqlite3
import json
import os
import re
from datetime import datetime

# Auto-load .env file if present
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from google import genai
from google.genai import types
import chromadb

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "notebook.db")
CHROMA_PATH = os.path.join(BASE_DIR, "chroma_data")

# ---------------------------------------------------------------------------
# Model names — adjust if your API key has different access
# ---------------------------------------------------------------------------
TEXT_MODEL  = "gemini-2.0-flash"          # fast & capable; change to gemini-1.5-pro if preferred
EMBED_MODEL = "text-embedding-004"         # stable embedding model

# ---------------------------------------------------------------------------
# Google GenAI client (singleton)
# ---------------------------------------------------------------------------

_genai_client: genai.Client | None = None

def get_client() -> genai.Client:
    global _genai_client
    if _genai_client is None:
        api_key = os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            raise RuntimeError("未設定 GOOGLE_API_KEY，請建立 .env 檔案或設定環境變數")
        _genai_client = genai.Client(api_key=api_key)
    return _genai_client


def embed_text(text: str) -> list[float]:
    """Generate embedding vector via Google text-embedding model."""
    client = get_client()
    result = client.models.embed_content(
        model=EMBED_MODEL,
        contents=text[:8000],
    )
    return result.embeddings[0].values


def stream_gemini(prompt: str):
    """Generator yielding text chunks from Gemini streaming response."""
    client = get_client()
    for chunk in client.models.generate_content_stream(
        model=TEXT_MODEL,
        contents=prompt,
    ):
        text = chunk.text
        if text:
            yield text


# ---------------------------------------------------------------------------
# ChromaDB (semantic vector store)
# ---------------------------------------------------------------------------

def get_chroma() -> chromadb.Collection:
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    return client.get_or_create_collection(
        name="notes",
        metadata={"hnsw:space": "cosine"},
    )


def upsert_embedding(note_id: int, title: str, content: str, tags: list[str]) -> None:
    """Upsert a note's embedding into ChromaDB (best-effort)."""
    try:
        col = get_chroma()
        doc = f"{title}\n\n{content}\n\nTags: {', '.join(tags)}"
        vec = embed_text(doc)
        col.upsert(
            ids=[str(note_id)],
            documents=[doc],
            embeddings=[vec],
            metadatas=[{"title": title, "note_id": note_id}],
        )
    except Exception as e:
        print(f"[embedding] upsert 失敗 (note #{note_id}): {e}")


def delete_embedding(note_id: int) -> None:
    try:
        get_chroma().delete(ids=[str(note_id)])
    except Exception:
        pass


def semantic_search(query: str, n_results: int = 10) -> list[dict]:
    """Vector similarity search via ChromaDB."""
    col = get_chroma()
    if col.count() == 0:
        return []
    try:
        qvec = embed_text(query)
        results = col.query(
            query_embeddings=[qvec],
            n_results=min(n_results, col.count()),
        )
        out = []
        for idx, mid in enumerate(results["ids"][0]):
            out.append({
                "note_id": int(mid),
                "distance": results["distances"][0][idx] if results.get("distances") else 0,
            })
        return out
    except Exception as e:
        print(f"[semantic_search] 失敗: {e}")
        return []


# ---------------------------------------------------------------------------
# SQLite Database
# ---------------------------------------------------------------------------

def init_db() -> None:
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
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            title, content, tags,
            content='notes', content_rowid='id'
        )
    """)
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


def _row_to_dict(row, cols) -> dict:
    n = dict(zip(cols, row))
    if "tags" in n:
        n["tags"] = json.loads(n["tags"])
    return n

_NOTE_COLS = ["id", "title", "content", "tags", "created_at", "updated_at"]


def db_get_note(note_id: int) -> dict | None:
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT id, title, content, tags, created_at, updated_at FROM notes WHERE id = ?",
        (note_id,),
    ).fetchone()
    conn.close()
    return _row_to_dict(row, _NOTE_COLS) if row else None


def db_all_notes() -> list[dict]:
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT id, title, content, tags, created_at, updated_at FROM notes ORDER BY updated_at DESC"
    ).fetchall()
    conn.close()
    return [_row_to_dict(r, _NOTE_COLS) for r in rows]


def db_fts_search(query: str, limit: int = 20) -> list[dict]:
    conn = sqlite3.connect(DB_PATH)
    cols = ["id", "title", "content", "tags", "created_at", "snippet"]
    try:
        rows = conn.execute("""
            SELECT n.id, n.title, n.content, n.tags, n.created_at,
                   snippet(notes_fts, 1, '**', '**', '...', 30) AS snippet
            FROM notes_fts
            JOIN notes n ON n.id = notes_fts.rowid
            WHERE notes_fts MATCH ?
            ORDER BY rank LIMIT ?
        """, (query, limit)).fetchall()
    except Exception:
        like = f"%{query}%"
        rows = conn.execute("""
            SELECT id, title, content, tags, created_at, SUBSTR(content,1,200) AS snippet
            FROM notes WHERE title LIKE ? OR content LIKE ? LIMIT ?
        """, (like, like, limit)).fetchall()
    conn.close()
    return [_row_to_dict(r, cols) for r in rows]


def db_save_note(title: str, content: str, tags: list | None = None) -> int:
    now = datetime.now().isoformat()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.execute(
        "INSERT INTO notes (title, content, tags, created_at, updated_at) VALUES (?,?,?,?,?)",
        (title, content, json.dumps(tags or []), now, now),
    )
    nid = cur.lastrowid
    conn.commit()
    conn.close()
    return nid


def db_update_note(note_id: int, content: str = None, tags: list = None) -> None:
    conn = sqlite3.connect(DB_PATH)
    now = datetime.now().isoformat()
    if content is not None and tags is not None:
        conn.execute("UPDATE notes SET content=?, tags=?, updated_at=? WHERE id=?",
                     (content, json.dumps(tags), now, note_id))
    elif content is not None:
        conn.execute("UPDATE notes SET content=?, updated_at=? WHERE id=?",
                     (content, now, note_id))
    elif tags is not None:
        conn.execute("UPDATE notes SET tags=?, updated_at=? WHERE id=?",
                     (json.dumps(tags), now, note_id))
    conn.commit()
    conn.close()


def db_delete_note(note_id: int) -> bool:
    conn = sqlite3.connect(DB_PATH)
    affected = conn.execute("DELETE FROM notes WHERE id=?", (note_id,)).rowcount
    conn.commit()
    conn.close()
    return affected > 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _sse_headers():
    return {"X-Accel-Buffering": "no", "Cache-Control": "no-cache"}


def run_autotag(note_id: int, title: str, content: str) -> list[str]:
    try:
        client = get_client()
        response = client.models.generate_content(
            model=TEXT_MODEL,
            contents=(
                f"為以下筆記產生 3-7 個相關標籤。只輸出 JSON 陣列，不要其他文字。\n"
                f"範例：[\"python\", \"程式設計\", \"教學\"]\n\n"
                f"標題：{title}\n內容：{content[:400]}"
            ),
        )
        text = response.text.strip()
        match = re.search(r"\[.*?\]", text, re.DOTALL)
        if match:
            tags = json.loads(match.group())
            db_update_note(note_id, tags=tags)
            return tags
    except Exception as e:
        print(f"[autotag] 失敗: {e}")
    return []


# ---------------------------------------------------------------------------
# Routes — pages
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status")
def api_status():
    """Check if API key is configured."""
    api_key = os.environ.get("GOOGLE_API_KEY")
    return jsonify({
        "api_key_set": bool(api_key),
        "text_model": TEXT_MODEL,
        "embed_model": EMBED_MODEL,
    })


# ---------------------------------------------------------------------------
# Routes — REST API
# ---------------------------------------------------------------------------

@app.route("/api/notes", methods=["GET"])
def api_list_notes():
    return jsonify(db_all_notes())


@app.route("/api/notes", methods=["POST"])
def api_add_note():
    data = request.get_json()
    title = (data.get("title") or "").strip()
    content = (data.get("content") or "").strip()
    if not title or not content:
        return jsonify({"error": "標題和內容不能為空"}), 400
    note_id = db_save_note(title, content)
    tags = run_autotag(note_id, title, content)
    upsert_embedding(note_id, title, content, tags)
    note = db_get_note(note_id)
    return jsonify(note), 201


@app.route("/api/notes/<int:note_id>", methods=["GET"])
def api_get_note(note_id):
    note = db_get_note(note_id)
    if not note:
        return jsonify({"error": "找不到筆記"}), 404
    return jsonify(note)


@app.route("/api/notes/<int:note_id>", methods=["DELETE"])
def api_delete_note(note_id):
    if not db_delete_note(note_id):
        return jsonify({"error": "找不到筆記"}), 404
    delete_embedding(note_id)
    return jsonify({"ok": True})


@app.route("/api/notes/<int:note_id>/autotag", methods=["POST"])
def api_autotag(note_id):
    note = db_get_note(note_id)
    if not note:
        return jsonify({"error": "找不到筆記"}), 404
    tags = run_autotag(note_id, note["title"], note["content"])
    upsert_embedding(note_id, note["title"], note["content"], tags)
    return jsonify({"tags": tags})


# ---------------------------------------------------------------------------
# Routes — AI streaming (SSE)
# ---------------------------------------------------------------------------

@app.route("/api/search", methods=["POST"])
def api_search():
    data = request.get_json()
    query = (data.get("query") or "").strip()
    if not query:
        return jsonify({"error": "請輸入搜尋詞"}), 400

    sem_hits = semantic_search(query, n_results=15)
    fts_results = db_fts_search(query, limit=15)

    all_ids = list(dict.fromkeys([h["note_id"] for h in sem_hits] +
                                 [r["id"] for r in fts_results]))
    notes_map = {n["id"]: n for n in db_all_notes()}

    pool = [notes_map[nid] for nid in all_ids if nid in notes_map]
    if not pool:
        pool = list(notes_map.values())[:50]

    def generate():
        if not pool:
            yield sse({"type": "text", "content": "記事本是空的，請先新增筆記。"})
            yield sse({"type": "done", "results": []})
            return

        overview = "\n".join(
            f"ID {r['id']}: {r['title']} — {r['content'][:100]}..."
            for r in pool
        )
        prompt = (
            f"你是一個智能筆記搜尋助手。用戶的搜尋關鍵字是：「{query}」\n\n"
            f"以下是根據語意向量排序的相關筆記：\n{overview}\n\n"
            f"請根據語意相關性排列筆記，說明每篇筆記與搜尋詞的關聯。\n"
            f"- 列出最相關的筆記（格式：**#ID 標題** — 原因）\n"
            f"- 最後給一句話總結\n"
            f"- 若都不相關，請如實說明"
        )
        try:
            for text in stream_gemini(prompt):
                yield sse({"type": "text", "content": text})
        except Exception as e:
            yield sse({"type": "error", "message": str(e)})
            return

        yield sse({"type": "done", "results": [
            {"id": r["id"], "title": r["title"],
             "snippet": r["content"][:120], "tags": r["tags"]}
            for r in pool[:8]
        ]})

    return Response(stream_with_context(generate()),
                    mimetype="text/event-stream", headers=_sse_headers())


@app.route("/api/notes/<int:note_id>/augment", methods=["POST"])
def api_augment(note_id):
    note = db_get_note(note_id)
    if not note:
        return jsonify({"error": "找不到筆記"}), 404

    def generate():
        prompt = (
            f"你是一個知識補充系統。請根據以下筆記的主題，補充更多相關知識：\n\n"
            f"**筆記標題**：{note['title']}\n"
            f"**筆記內容**：\n{note['content']}\n\n"
            f"請補充：\n"
            f"1. 相關概念與延伸說明\n"
            f"2. 可能遺漏的重要細節\n"
            f"3. 實際應用範例或使用場景\n"
            f"4. 與其他相關主題的連結\n"
            f"5. 值得深入了解的延伸方向\n\n"
            f"請以清晰有結構的方式撰寫（使用與筆記相同的語言）。"
        )
        buf = []
        try:
            for text in stream_gemini(prompt):
                buf.append(text)
                yield sse({"type": "text", "content": text})
        except Exception as e:
            yield sse({"type": "error", "message": str(e)})
            return

        supplement = "".join(buf)
        new_content = note["content"] + "\n\n---\n**🤖 AI 補充知識：**\n\n" + supplement
        db_update_note(note_id, content=new_content)
        upsert_embedding(note_id, note["title"], new_content, note["tags"])
        yield sse({"type": "done", "message": "已補充並儲存至筆記", "note_id": note_id})

    return Response(stream_with_context(generate()),
                    mimetype="text/event-stream", headers=_sse_headers())


@app.route("/api/notes/<int:note_id>/improve", methods=["POST"])
def api_improve(note_id):
    note = db_get_note(note_id)
    if not note:
        return jsonify({"error": "找不到筆記"}), 404

    def generate():
        prompt = (
            f"請改善以下筆記的品質，包括：\n"
            f"1. 改善清晰度與可讀性\n"
            f"2. 加入更好的結構（標題、條列式）\n"
            f"3. 修正任何不精確的說法\n"
            f"4. 保留所有重要資訊，並使整體更簡潔有力\n\n"
            f"**標題**：{note['title']}\n"
            f"**原始內容**：\n{note['content']}\n\n"
            f"請直接輸出改善後的筆記內容（使用與原文相同的語言），不需要額外說明。"
        )
        buf = []
        try:
            for text in stream_gemini(prompt):
                buf.append(text)
                yield sse({"type": "text", "content": text})
        except Exception as e:
            yield sse({"type": "error", "message": str(e)})
            return

        improved = "".join(buf)
        db_update_note(note_id, content=improved)
        upsert_embedding(note_id, note["title"], improved, note["tags"])
        yield sse({"type": "done", "message": "已改善並儲存至筆記", "note_id": note_id})

    return Response(stream_with_context(generate()),
                    mimetype="text/event-stream", headers=_sse_headers())


@app.route("/api/analyze", methods=["GET"])
def api_analyze():
    notes = db_all_notes()

    def generate():
        if not notes:
            yield sse({"type": "text", "content": "記事本是空的，請先新增筆記。"})
            yield sse({"type": "done"})
            return

        overview = "\n".join(
            f"#{n['id']}: {n['title']} | 標籤: {', '.join(n['tags']) or '無'}"
            for n in notes
        )
        prompt = (
            f"你是一位知識管理顧問。請分析以下記事本的知識結構：\n\n"
            f"**目前的筆記：**\n{overview}\n\n"
            f"請提供：\n"
            f"1. **知識缺口分析**：哪些重要主題或關聯性缺失？\n"
            f"2. **建議新增筆記**：具體建議 3-5 個應該新增的主題\n"
            f"3. **知識連結地圖**：現有筆記彼此之間的關聯性\n"
            f"4. **優先改善建議**：哪 2-3 篇筆記最需要擴充或改善？\n\n"
            f"請給出具體且可執行的建議。"
        )
        try:
            for text in stream_gemini(prompt):
                yield sse({"type": "text", "content": text})
        except Exception as e:
            yield sse({"type": "error", "message": str(e)})
            return

        yield sse({"type": "done"})

    return Response(stream_with_context(generate()),
                    mimetype="text/event-stream", headers=_sse_headers())


@app.route("/api/summarize", methods=["POST"])
def api_summarize():
    data = request.get_json()
    topic = (data.get("topic") or "").strip()
    if not topic:
        return jsonify({"error": "請輸入主題"}), 400

    sem_hits = semantic_search(topic, n_results=10)
    fts_results = db_fts_search(topic, limit=10)

    all_ids = list(dict.fromkeys(
        [h["note_id"] for h in sem_hits] + [r["id"] for r in fts_results]
    ))
    notes_map = {n["id"]: n for n in db_all_notes()}
    results = [notes_map[nid] for nid in all_ids if nid in notes_map]

    def generate():
        if not results:
            yield sse({"type": "text", "content": f"找不到與「{topic}」相關的筆記。"})
            yield sse({"type": "done"})
            return

        notes_content = "\n\n---\n\n".join(
            f"**#{r['id']} {r['title']}**\n{r['content']}"
            for r in results
        )
        prompt = (
            f"請根據以下筆記，針對主題「{topic}」合成一份全面的知識摘要：\n\n"
            f"{notes_content}\n\n"
            f"請包含：\n"
            f"1. 主題核心概念的清晰摘要\n"
            f"2. 整合各筆記的關鍵洞見\n"
            f"3. 不同觀點或方法的對比\n"
            f"4. 知識的實際應用\n"
            f"5. 尚待補充的知識空白\n\n"
            f"格式要清晰有層次。"
        )
        try:
            for text in stream_gemini(prompt):
                yield sse({"type": "text", "content": text})
        except Exception as e:
            yield sse({"type": "error", "message": str(e)})
            return

        yield sse({"type": "done"})

    return Response(stream_with_context(generate()),
                    mimetype="text/event-stream", headers=_sse_headers())


# ---------------------------------------------------------------------------
# Routes — Mind Map (知識地圖)
# ---------------------------------------------------------------------------

@app.route("/api/mindmap", methods=["GET"])
def api_mindmap():
    notes = db_all_notes()

    def generate():
        if not notes:
            yield sse({"type": "text", "content": "記事本是空的，請先新增筆記。"})
            yield sse({"type": "done"})
            return

        overview = "\n".join(
            f"#{n['id']}: {n['title']}\n   內容摘要: {n['content'][:150]}...\n   標籤: {', '.join(n['tags']) or '無'}"
            for n in notes
        )

        analysis_prompt = (
            f"你是一位知識架構師。請分析以下所有筆記，產出一份「知識地圖」報告：\n\n"
            f"{overview}\n\n"
            f"請完成以下工作：\n"
            f"1. **主題群組**：將筆記分成幾個知識領域/群組\n"
            f"2. **連結關係**：說明筆記之間的關聯（哪些筆記共享概念、互相補充或依賴）\n"
            f"3. **核心節點**：哪些筆記是知識網路中最重要的樞紐？\n"
            f"4. **擴展建議**：基於現有知識地圖，建議下一步可以新增的 3 個知識節點\n\n"
            f"最後，請產生一段 Mermaid mindmap 圖表語法來視覺化這個知識地圖。\n"
            f"語法範例：\n"
            f"```mermaid\n"
            f"mindmap\n"
            f"  root((我的知識庫))\n"
            f"    程式設計\n"
            f"      Python\n"
            f"      Flask\n"
            f"    資料科學\n"
            f"      機器學習\n"
            f"```\n"
            f"請用繁體中文，確保 Mermaid 語法正確可渲染。"
        )

        buf = []
        try:
            for text in stream_gemini(analysis_prompt):
                buf.append(text)
                yield sse({"type": "text", "content": text})
        except Exception as e:
            yield sse({"type": "error", "message": str(e)})
            return

        full = "".join(buf)
        match = re.search(r"```mermaid\s*\n(.*?)```", full, re.DOTALL)
        if match:
            yield sse({"type": "mermaid", "content": match.group(1).strip()})

        yield sse({"type": "done"})

    return Response(stream_with_context(generate()),
                    mimetype="text/event-stream", headers=_sse_headers())


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5000))
    api_key = os.environ.get("GOOGLE_API_KEY")
    print(f"\n🧠 智腦記事本 (Google GenAI + ChromaDB) 已啟動！")
    print(f"   📡 文字模型：{TEXT_MODEL}")
    print(f"   🔢 嵌入模型：{EMBED_MODEL}")
    print(f"   🔑 API 金鑰：{'✓ 已設定' if api_key else '✗ 未設定（請建立 .env 或設定 GOOGLE_API_KEY）'}")
    print(f"   🌐 網址：http://localhost:{port}\n")
    app.run(debug=True, threaded=True, port=port)
