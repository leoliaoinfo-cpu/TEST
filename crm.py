#!/usr/bin/env python3
"""
CRM 客戶關係管理系統
使用方式：python crm.py → 瀏覽器開啟 http://localhost:5001
"""

from flask import Flask, request, jsonify, render_template, redirect, url_for, flash
import sqlite3
import os
from datetime import datetime, date

app = Flask(__name__, template_folder="templates")
app.secret_key = os.environ.get("SECRET_KEY", "crm-secret-key-2024")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "crm.db")

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS customers (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL,
                company     TEXT,
                title       TEXT,
                phone       TEXT,
                email       TEXT,
                address     TEXT,
                industry    TEXT,
                status      TEXT NOT NULL DEFAULT 'prospect',
                source      TEXT,
                notes       TEXT,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS contacts (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id      INTEGER NOT NULL,
                contact_date     DATETIME NOT NULL,
                type             TEXT NOT NULL,
                content          TEXT NOT NULL,
                result           TEXT,
                next_action      TEXT,
                next_action_date DATE,
                created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS opportunities (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id         INTEGER NOT NULL,
                title               TEXT NOT NULL,
                amount              REAL DEFAULT 0,
                stage               TEXT NOT NULL DEFAULT 'prospecting',
                probability         INTEGER DEFAULT 10,
                expected_close_date DATE,
                description         TEXT,
                created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
            );
        """)


# Stage settings
STAGES = [
    ("prospecting",   "開發中",   10,  "secondary"),
    ("qualification", "需求確認", 25,  "info"),
    ("proposal",      "提案報價", 50,  "primary"),
    ("negotiation",   "議價協商", 75,  "warning"),
    ("won",           "成交",    100, "success"),
    ("lost",          "失敗",      0,  "danger"),
]
STAGE_MAP = {s[0]: {"label": s[1], "prob": s[2], "color": s[3]} for s in STAGES}

CONTACT_TYPES = ["電話", "會議", "Email", "LINE", "拜訪", "其他"]
INDUSTRIES    = ["科技", "製造", "金融", "醫療", "零售", "餐飲", "建設", "教育", "物流", "其他"]
SOURCES       = ["業務開發", "客戶介紹", "官網詢問", "展覽活動", "廣告", "其他"]
STATUSES      = [("prospect", "潛在客戶"), ("active", "往來客戶"), ("inactive", "非活躍")]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def query(sql, params=(), one=False):
    with get_db() as conn:
        cur = conn.execute(sql, params)
        return cur.fetchone() if one else cur.fetchall()


def execute(sql, params=()):
    with get_db() as conn:
        cur = conn.execute(sql, params)
        conn.commit()
        return cur.lastrowid


def fmt_amount(v):
    if v is None:
        return "-"
    return f"NT$ {int(v):,}"


app.jinja_env.globals.update(
    STAGE_MAP=STAGE_MAP,
    STAGES=STAGES,
    CONTACT_TYPES=CONTACT_TYPES,
    INDUSTRIES=INDUSTRIES,
    SOURCES=SOURCES,
    STATUSES=STATUSES,
    fmt_amount=fmt_amount,
    today=date.today,
)

# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

@app.route("/")
def dashboard():
    total_customers   = query("SELECT COUNT(*) AS n FROM customers", one=True)["n"]
    active_customers  = query("SELECT COUNT(*) AS n FROM customers WHERE status='active'", one=True)["n"]
    prospect_customers= query("SELECT COUNT(*) AS n FROM customers WHERE status='prospect'", one=True)["n"]
    total_opps        = query("SELECT COUNT(*) AS n FROM opportunities WHERE stage NOT IN ('won','lost')", one=True)["n"]
    pipeline_value    = query("SELECT COALESCE(SUM(amount),0) AS v FROM opportunities WHERE stage NOT IN ('won','lost')", one=True)["v"]
    won_value         = query("SELECT COALESCE(SUM(amount),0) AS v FROM opportunities WHERE stage='won'", one=True)["v"]

    # Recent contacts (last 5)
    recent_contacts = query("""
        SELECT c.*, cu.name AS customer_name, cu.company
        FROM contacts c JOIN customers cu ON c.customer_id = cu.id
        ORDER BY c.contact_date DESC LIMIT 5
    """)

    # Upcoming next actions
    upcoming = query("""
        SELECT c.*, cu.name AS customer_name, cu.company
        FROM contacts c JOIN customers cu ON c.customer_id = cu.id
        WHERE c.next_action_date IS NOT NULL AND c.next_action_date >= date('now')
        ORDER BY c.next_action_date ASC LIMIT 5
    """)

    # Stage distribution
    stage_counts = query("""
        SELECT stage, COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS total
        FROM opportunities WHERE stage NOT IN ('won','lost')
        GROUP BY stage
    """)

    return render_template("crm_dashboard.html",
        total_customers=total_customers,
        active_customers=active_customers,
        prospect_customers=prospect_customers,
        total_opps=total_opps,
        pipeline_value=pipeline_value,
        won_value=won_value,
        recent_contacts=recent_contacts,
        upcoming=upcoming,
        stage_counts=stage_counts,
    )

# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------

@app.route("/customers")
def customers():
    search   = request.args.get("q", "").strip()
    status   = request.args.get("status", "")
    industry = request.args.get("industry", "")

    sql = """
        SELECT cu.*,
               COUNT(DISTINCT c.id)  AS contact_count,
               COUNT(DISTINCT o.id)  AS opp_count
        FROM customers cu
        LEFT JOIN contacts      c ON c.customer_id = cu.id
        LEFT JOIN opportunities o ON o.customer_id = cu.id
        WHERE 1=1
    """
    params = []
    if search:
        sql += " AND (cu.name LIKE ? OR cu.company LIKE ? OR cu.phone LIKE ? OR cu.email LIKE ?)"
        params.extend([f"%{search}%"] * 4)
    if status:
        sql += " AND cu.status = ?"
        params.append(status)
    if industry:
        sql += " AND cu.industry = ?"
        params.append(industry)
    sql += " GROUP BY cu.id ORDER BY cu.updated_at DESC"

    rows = query(sql, params)
    return render_template("crm_customers.html", customers=rows,
                           search=search, sel_status=status, sel_industry=industry)


@app.route("/customers/new", methods=["GET", "POST"])
def customer_new():
    if request.method == "POST":
        cid = execute("""
            INSERT INTO customers (name,company,title,phone,email,address,industry,status,source,notes)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (
            request.form["name"], request.form.get("company"), request.form.get("title"),
            request.form.get("phone"), request.form.get("email"), request.form.get("address"),
            request.form.get("industry"), request.form.get("status","prospect"),
            request.form.get("source"), request.form.get("notes"),
        ))
        flash("客戶已新增", "success")
        return redirect(url_for("customer_detail", cid=cid))
    return render_template("crm_customer_form.html", customer=None)


@app.route("/customers/<int:cid>")
def customer_detail(cid):
    customer = query("SELECT * FROM customers WHERE id=?", (cid,), one=True)
    if not customer:
        flash("找不到客戶", "danger")
        return redirect(url_for("customers"))

    contacts_list = query("""
        SELECT * FROM contacts WHERE customer_id=? ORDER BY contact_date DESC
    """, (cid,))

    opps = query("""
        SELECT * FROM opportunities WHERE customer_id=? ORDER BY updated_at DESC
    """, (cid,))

    return render_template("crm_customer_detail.html",
                           customer=customer, contacts=contacts_list, opps=opps)


@app.route("/customers/<int:cid>/edit", methods=["GET", "POST"])
def customer_edit(cid):
    customer = query("SELECT * FROM customers WHERE id=?", (cid,), one=True)
    if not customer:
        flash("找不到客戶", "danger")
        return redirect(url_for("customers"))

    if request.method == "POST":
        execute("""
            UPDATE customers SET name=?,company=?,title=?,phone=?,email=?,address=?,
            industry=?,status=?,source=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
        """, (
            request.form["name"], request.form.get("company"), request.form.get("title"),
            request.form.get("phone"), request.form.get("email"), request.form.get("address"),
            request.form.get("industry"), request.form.get("status","prospect"),
            request.form.get("source"), request.form.get("notes"), cid,
        ))
        flash("客戶資料已更新", "success")
        return redirect(url_for("customer_detail", cid=cid))
    return render_template("crm_customer_form.html", customer=customer)


@app.route("/customers/<int:cid>/delete", methods=["POST"])
def customer_delete(cid):
    execute("DELETE FROM customers WHERE id=?", (cid,))
    flash("客戶已刪除", "warning")
    return redirect(url_for("customers"))

# ---------------------------------------------------------------------------
# Contacts
# ---------------------------------------------------------------------------

@app.route("/customers/<int:cid>/contacts/new", methods=["GET", "POST"])
def contact_new(cid):
    customer = query("SELECT * FROM customers WHERE id=?", (cid,), one=True)
    if not customer:
        return redirect(url_for("customers"))

    if request.method == "POST":
        execute("""
            INSERT INTO contacts (customer_id,contact_date,type,content,result,next_action,next_action_date)
            VALUES (?,?,?,?,?,?,?)
        """, (
            cid,
            request.form.get("contact_date", datetime.now().strftime("%Y-%m-%d %H:%M")),
            request.form["type"],
            request.form["content"],
            request.form.get("result"),
            request.form.get("next_action"),
            request.form.get("next_action_date") or None,
        ))
        execute("UPDATE customers SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (cid,))
        flash("聯絡紀錄已新增", "success")
        return redirect(url_for("customer_detail", cid=cid))
    return render_template("crm_contact_form.html", customer=customer,
                           contact=None, now=datetime.now().strftime("%Y-%m-%dT%H:%M"))


@app.route("/contacts/<int:rid>/delete", methods=["POST"])
def contact_delete(rid):
    row = query("SELECT customer_id FROM contacts WHERE id=?", (rid,), one=True)
    cid = row["customer_id"] if row else None
    execute("DELETE FROM contacts WHERE id=?", (rid,))
    flash("紀錄已刪除", "warning")
    return redirect(url_for("customer_detail", cid=cid) if cid else url_for("customers"))

# ---------------------------------------------------------------------------
# Opportunities
# ---------------------------------------------------------------------------

@app.route("/opportunities")
def opportunities():
    stage_filter = request.args.get("stage", "")
    sql = """
        SELECT o.*, cu.name AS customer_name, cu.company
        FROM opportunities o JOIN customers cu ON o.customer_id = cu.id
        WHERE 1=1
    """
    params = []
    if stage_filter:
        sql += " AND o.stage=?"
        params.append(stage_filter)
    sql += " ORDER BY o.updated_at DESC"
    rows = query(sql, params)

    # Pipeline summary per stage (active only)
    pipeline = query("""
        SELECT stage, COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS total
        FROM opportunities WHERE stage NOT IN ('won','lost')
        GROUP BY stage
    """)

    return render_template("crm_opportunities.html", opps=rows,
                           pipeline=pipeline, sel_stage=stage_filter)


@app.route("/customers/<int:cid>/opportunities/new", methods=["GET", "POST"])
def opportunity_new(cid):
    customer = query("SELECT * FROM customers WHERE id=?", (cid,), one=True)
    if not customer:
        return redirect(url_for("customers"))

    if request.method == "POST":
        stage = request.form.get("stage", "prospecting")
        prob  = STAGE_MAP.get(stage, {}).get("prob", 10)
        execute("""
            INSERT INTO opportunities (customer_id,title,amount,stage,probability,expected_close_date,description)
            VALUES (?,?,?,?,?,?,?)
        """, (
            cid,
            request.form["title"],
            float(request.form.get("amount") or 0),
            stage, prob,
            request.form.get("expected_close_date") or None,
            request.form.get("description"),
        ))
        execute("UPDATE customers SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (cid,))
        flash("商機已新增", "success")
        return redirect(url_for("customer_detail", cid=cid))
    return render_template("crm_opportunity_form.html", customer=customer, opp=None)


@app.route("/opportunities/<int:oid>/edit", methods=["GET", "POST"])
def opportunity_edit(oid):
    opp = query("SELECT * FROM opportunities WHERE id=?", (oid,), one=True)
    if not opp:
        return redirect(url_for("opportunities"))
    customer = query("SELECT * FROM customers WHERE id=?", (opp["customer_id"],), one=True)

    if request.method == "POST":
        stage = request.form.get("stage", opp["stage"])
        prob  = STAGE_MAP.get(stage, {}).get("prob", opp["probability"])
        execute("""
            UPDATE opportunities SET title=?,amount=?,stage=?,probability=?,
            expected_close_date=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
        """, (
            request.form["title"],
            float(request.form.get("amount") or 0),
            stage, prob,
            request.form.get("expected_close_date") or None,
            request.form.get("description"),
            oid,
        ))
        flash("商機已更新", "success")
        return redirect(url_for("customer_detail", cid=opp["customer_id"]))
    return render_template("crm_opportunity_form.html", customer=customer, opp=opp)


@app.route("/opportunities/<int:oid>/delete", methods=["POST"])
def opportunity_delete(oid):
    opp = query("SELECT customer_id FROM opportunities WHERE id=?", (oid,), one=True)
    cid = opp["customer_id"] if opp else None
    execute("DELETE FROM opportunities WHERE id=?", (oid,))
    flash("商機已刪除", "warning")
    return redirect(url_for("customer_detail", cid=cid) if cid else url_for("opportunities"))


# ---------------------------------------------------------------------------
# API (JSON) — for quick AJAX stage updates
# ---------------------------------------------------------------------------

@app.route("/api/opportunities/<int:oid>/stage", methods=["POST"])
def api_update_stage(oid):
    data  = request.get_json(force=True)
    stage = data.get("stage")
    if stage not in STAGE_MAP:
        return jsonify({"error": "invalid stage"}), 400
    prob = STAGE_MAP[stage]["prob"]
    execute("UPDATE opportunities SET stage=?,probability=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (stage, prob, oid))
    return jsonify({"ok": True, "stage": stage, "label": STAGE_MAP[stage]["label"]})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    init_db()
    print("CRM 系統啟動：http://localhost:5001")
    app.run(debug=True, port=5001)
