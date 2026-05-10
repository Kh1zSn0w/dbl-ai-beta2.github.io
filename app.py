import os
import sqlite3
import threading
import webbrowser
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import Flask, jsonify, render_template, request
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(BASE_DIR, "business.db")
SECRET_KEY = os.environ.get("APP_SECRET_KEY", "change-this-secret-key")
TOKEN_EXP_HOURS = 12
LOW_STOCK_THRESHOLD = 10

app = Flask(__name__)


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin', 'staff')),
            created_at TEXT NOT NULL
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT,
            phone TEXT,
            address TEXT,
            created_at TEXT NOT NULL
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sku TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            price REAL NOT NULL CHECK(price >= 0),
            stock_quantity INTEGER NOT NULL CHECK(stock_quantity >= 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER,
            total_amount REAL NOT NULL,
            created_by INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (customer_id) REFERENCES customers(id),
            FOREIGN KEY (created_by) REFERENCES users(id)
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS sale_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL CHECK(quantity > 0),
            unit_price REAL NOT NULL CHECK(unit_price >= 0),
            line_total REAL NOT NULL CHECK(line_total >= 0),
            FOREIGN KEY (sale_id) REFERENCES sales(id),
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
        """
    )

    existing_admin = cur.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1").fetchone()
    if not existing_admin:
        cur.execute(
            """
            INSERT INTO users (full_name, username, password_hash, role, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                "System Admin",
                "admin",
                generate_password_hash("admin123"),
                "admin",
                datetime.now(timezone.utc).isoformat(),
            ),
        )

    conn.commit()
    conn.close()


def token_for_user(user_row):
    payload = {
        "sub": str(user_row["id"]),
        "username": user_row["username"],
        "role": user_row["role"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXP_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def auth_required(roles=None):
    roles = roles or []

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return jsonify({"error": "Missing or invalid token"}), 401

            token = auth_header.split(" ", 1)[1]
            try:
                payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            except jwt.InvalidTokenError:
                return jsonify({"error": "Invalid or expired token"}), 401

            if roles and payload.get("role") not in roles:
                return jsonify({"error": "Insufficient permissions"}), 403

            request.user = payload
            return fn(*args, **kwargs)

        return wrapper

    return decorator


@app.route("/")
def index():
    return render_template("index.html")


@app.post("/api/auth/login")
def login():
    body = request.get_json(force=True)
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""

    conn = get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid credentials"}), 401

    token = token_for_user(user)
    return jsonify(
        {
            "token": token,
            "user": {
                "id": user["id"],
                "full_name": user["full_name"],
                "username": user["username"],
                "role": user["role"],
            },
        }
    )


@app.get("/api/auth/me")
@auth_required()
def me():
    return jsonify({"user": request.user})


@app.get("/api/users")
@auth_required(["admin"])
def list_users():
    conn = get_db_connection()
    rows = conn.execute("SELECT id, full_name, username, role, created_at FROM users ORDER BY id DESC").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.post("/api/users")
@auth_required(["admin"])
def create_user():
    body = request.get_json(force=True)
    full_name = (body.get("full_name") or "").strip()
    username = (body.get("username") or "").strip().lower()
    password = body.get("password") or ""
    role = (body.get("role") or "staff").strip().lower()

    if not full_name or not username or not password or role not in {"admin", "staff"}:
        return jsonify({"error": "Invalid input"}), 400

    conn = get_db_connection()
    try:
        conn.execute(
            """
            INSERT INTO users (full_name, username, password_hash, role, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (full_name, username, generate_password_hash(password), role, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "Username already exists"}), 409

    conn.close()
    return jsonify({"message": "User created"}), 201


@app.get("/api/customers")
@auth_required()
def list_customers():
    q = (request.args.get("q") or "").strip().lower()
    conn = get_db_connection()

    if q:
        rows = conn.execute(
            """
            SELECT * FROM customers
            WHERE lower(name) LIKE ? OR lower(ifnull(email, '')) LIKE ? OR lower(ifnull(phone, '')) LIKE ?
            ORDER BY id DESC
            """,
            (f"%{q}%", f"%{q}%", f"%{q}%"),
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM customers ORDER BY id DESC").fetchall()

    conn.close()
    return jsonify([dict(r) for r in rows])


@app.post("/api/customers")
@auth_required()
def create_customer():
    body = request.get_json(force=True)
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip()
    phone = (body.get("phone") or "").strip()
    address = (body.get("address") or "").strip()

    if not name:
        return jsonify({"error": "Customer name is required"}), 400

    conn = get_db_connection()
    conn.execute(
        "INSERT INTO customers (name, email, phone, address, created_at) VALUES (?, ?, ?, ?, ?)",
        (name, email, phone, address, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()
    return jsonify({"message": "Customer created"}), 201


@app.put("/api/customers/<int:customer_id>")
@auth_required()
def update_customer(customer_id):
    body = request.get_json(force=True)
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip()
    phone = (body.get("phone") or "").strip()
    address = (body.get("address") or "").strip()

    if not name:
        return jsonify({"error": "Customer name is required"}), 400

    conn = get_db_connection()
    updated = conn.execute(
        """
        UPDATE customers
        SET name = ?, email = ?, phone = ?, address = ?
        WHERE id = ?
        """,
        (name, email, phone, address, customer_id),
    )
    conn.commit()
    conn.close()

    if updated.rowcount == 0:
        return jsonify({"error": "Customer not found"}), 404

    return jsonify({"message": "Customer updated"})


@app.delete("/api/customers/<int:customer_id>")
@auth_required(["admin"])
def delete_customer(customer_id):
    conn = get_db_connection()
    deleted = conn.execute("DELETE FROM customers WHERE id = ?", (customer_id,))
    conn.commit()
    conn.close()

    if deleted.rowcount == 0:
        return jsonify({"error": "Customer not found"}), 404

    return jsonify({"message": "Customer deleted"})


@app.get("/api/products")
@auth_required()
def list_products():
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM products ORDER BY id DESC").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.post("/api/products")
@auth_required(["admin", "staff"])
def create_product():
    body = request.get_json(force=True)
    sku = (body.get("sku") or "").strip().upper()
    name = (body.get("name") or "").strip()
    price = body.get("price")
    stock_quantity = body.get("stock_quantity")

    if not sku or not name:
        return jsonify({"error": "SKU and product name are required"}), 400

    try:
        price = float(price)
        stock_quantity = int(stock_quantity)
        if price < 0 or stock_quantity < 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid price or stock quantity"}), 400

    now = datetime.now(timezone.utc).isoformat()
    conn = get_db_connection()
    try:
        conn.execute(
            """
            INSERT INTO products (sku, name, price, stock_quantity, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (sku, name, price, stock_quantity, now, now),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "SKU already exists"}), 409

    conn.close()
    return jsonify({"message": "Product created"}), 201


@app.put("/api/products/<int:product_id>")
@auth_required(["admin", "staff"])
def update_product(product_id):
    body = request.get_json(force=True)
    sku = (body.get("sku") or "").strip().upper()
    name = (body.get("name") or "").strip()
    price = body.get("price")
    stock_quantity = body.get("stock_quantity")

    if not sku or not name:
        return jsonify({"error": "SKU and product name are required"}), 400

    try:
        price = float(price)
        stock_quantity = int(stock_quantity)
        if price < 0 or stock_quantity < 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid price or stock quantity"}), 400

    conn = get_db_connection()
    try:
        updated = conn.execute(
            """
            UPDATE products
            SET sku = ?, name = ?, price = ?, stock_quantity = ?, updated_at = ?
            WHERE id = ?
            """,
            (sku, name, price, stock_quantity, datetime.now(timezone.utc).isoformat(), product_id),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "SKU already exists"}), 409

    conn.close()
    if updated.rowcount == 0:
        return jsonify({"error": "Product not found"}), 404

    return jsonify({"message": "Product updated"})


@app.delete("/api/products/<int:product_id>")
@auth_required(["admin"])
def delete_product(product_id):
    conn = get_db_connection()
    deleted = conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
    conn.commit()
    conn.close()

    if deleted.rowcount == 0:
        return jsonify({"error": "Product not found"}), 404

    return jsonify({"message": "Product deleted"})


@app.get("/api/inventory/low-stock")
@auth_required()
def low_stock_products():
    conn = get_db_connection()
    rows = conn.execute(
        "SELECT * FROM products WHERE stock_quantity <= ? ORDER BY stock_quantity ASC",
        (LOW_STOCK_THRESHOLD,),
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.post("/api/sales")
@auth_required(["admin", "staff"])
def create_sale():
    body = request.get_json(force=True)
    customer_id = body.get("customer_id")
    items = body.get("items") or []

    if not isinstance(items, list) or not items:
        return jsonify({"error": "At least one sale item is required"}), 400

    conn = get_db_connection()
    cur = conn.cursor()

    try:
        if customer_id:
            customer = cur.execute("SELECT id FROM customers WHERE id = ?", (customer_id,)).fetchone()
            if not customer:
                conn.close()
                return jsonify({"error": "Customer not found"}), 404

        parsed_items = []
        total_amount = 0.0

        for item in items:
            product_id = item.get("product_id")
            quantity = item.get("quantity")

            try:
                product_id = int(product_id)
                quantity = int(quantity)
                if quantity <= 0:
                    raise ValueError
            except (TypeError, ValueError):
                conn.close()
                return jsonify({"error": "Invalid product or quantity in items"}), 400

            product = cur.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
            if not product:
                conn.close()
                return jsonify({"error": f"Product {product_id} not found"}), 404
            if product["stock_quantity"] < quantity:
                conn.close()
                return jsonify({"error": f"Insufficient stock for {product['name']}"}), 400

            unit_price = float(product["price"])
            line_total = unit_price * quantity
            parsed_items.append(
                {
                    "product_id": product_id,
                    "quantity": quantity,
                    "unit_price": unit_price,
                    "line_total": line_total,
                }
            )
            total_amount += line_total

        now = datetime.now(timezone.utc).isoformat()
        cur.execute(
            "INSERT INTO sales (customer_id, total_amount, created_by, created_at) VALUES (?, ?, ?, ?)",
            (customer_id, total_amount, int(request.user["sub"]), now),
        )
        sale_id = cur.lastrowid

        for item in parsed_items:
            cur.execute(
                """
                INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total)
                VALUES (?, ?, ?, ?, ?)
                """,
                (sale_id, item["product_id"], item["quantity"], item["unit_price"], item["line_total"]),
            )
            cur.execute(
                "UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ?",
                (item["quantity"], now, item["product_id"]),
            )

        conn.commit()
    except Exception:
        conn.rollback()
        conn.close()
        raise

    conn.close()
    return jsonify({"message": "Sale recorded", "sale_id": sale_id, "total_amount": round(total_amount, 2)}), 201


@app.get("/api/sales")
@auth_required()
def list_sales():
    conn = get_db_connection()
    rows = conn.execute(
        """
        SELECT s.id, s.total_amount, s.created_at, c.name AS customer_name, u.username AS created_by_username
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        INNER JOIN users u ON u.id = s.created_by
        ORDER BY s.id DESC
        """
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.get("/api/sales/<int:sale_id>/receipt")
@auth_required()
def sale_receipt(sale_id):
    conn = get_db_connection()
    sale = conn.execute(
        """
        SELECT s.id, s.total_amount, s.created_at, c.name AS customer_name, c.phone AS customer_phone, u.full_name AS cashier
        FROM sales s
        LEFT JOIN customers c ON c.id = s.customer_id
        INNER JOIN users u ON u.id = s.created_by
        WHERE s.id = ?
        """,
        (sale_id,),
    ).fetchone()

    if not sale:
        conn.close()
        return jsonify({"error": "Sale not found"}), 404

    items = conn.execute(
        """
        SELECT p.sku, p.name, si.quantity, si.unit_price, si.line_total
        FROM sale_items si
        INNER JOIN products p ON p.id = si.product_id
        WHERE si.sale_id = ?
        """,
        (sale_id,),
    ).fetchall()
    conn.close()

    return jsonify({"sale": dict(sale), "items": [dict(i) for i in items]})


@app.get("/api/reports/sales")
@auth_required()
def sales_report():
    conn = get_db_connection()
    daily_rows = conn.execute(
        """
        SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS total_transactions, ROUND(SUM(total_amount), 2) AS total_sales
        FROM sales
        GROUP BY substr(created_at, 1, 10)
        ORDER BY date DESC
        LIMIT 30
        """
    ).fetchall()

    monthly_rows = conn.execute(
        """
        SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS total_transactions, ROUND(SUM(total_amount), 2) AS total_sales
        FROM sales
        GROUP BY substr(created_at, 1, 7)
        ORDER BY month DESC
        LIMIT 12
        """
    ).fetchall()
    conn.close()

    return jsonify({"daily": [dict(r) for r in daily_rows], "monthly": [dict(r) for r in monthly_rows]})


@app.get("/api/reports/inventory")
@auth_required()
def inventory_report():
    conn = get_db_connection()
    summary = conn.execute(
        """
        SELECT
            COUNT(*) AS total_products,
            COALESCE(SUM(stock_quantity), 0) AS total_units,
            ROUND(COALESCE(SUM(stock_quantity * price), 0), 2) AS inventory_value
        FROM products
        """
    ).fetchone()

    low_stock = conn.execute(
        "SELECT id, sku, name, stock_quantity FROM products WHERE stock_quantity <= ? ORDER BY stock_quantity ASC",
        (LOW_STOCK_THRESHOLD,),
    ).fetchall()
    conn.close()

    return jsonify({"summary": dict(summary), "low_stock": [dict(r) for r in low_stock]})


@app.get("/api/dashboard")
@auth_required()
def dashboard():
    conn = get_db_connection()
    metrics = conn.execute(
        """
        SELECT
            (SELECT COUNT(*) FROM customers) AS total_customers,
            (SELECT COUNT(*) FROM products) AS total_products,
            (SELECT COUNT(*) FROM sales) AS total_transactions,
            ROUND((SELECT COALESCE(SUM(total_amount), 0) FROM sales), 2) AS total_revenue,
            ROUND((SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE substr(created_at, 1, 10) = date('now')), 2) AS today_revenue
        """
    ).fetchone()

    top_products = conn.execute(
        """
        SELECT p.name, SUM(si.quantity) AS quantity_sold
        FROM sale_items si
        INNER JOIN products p ON p.id = si.product_id
        GROUP BY si.product_id
        ORDER BY quantity_sold DESC
        LIMIT 5
        """
    ).fetchall()
    conn.close()

    return jsonify({"metrics": dict(metrics), "top_products": [dict(r) for r in top_products]})


def open_browser(url):
    webbrowser.open(url)


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "5000"))
    url = f"http://127.0.0.1:{port}"

    threading.Timer(1.0, open_browser, args=(url,)).start()
    app.run(host="0.0.0.0", port=port, debug=False)
