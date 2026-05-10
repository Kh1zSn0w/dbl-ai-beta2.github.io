# Business Operations Platform

Centralized, cloud-ready web application for:
- Customer management
- Inventory management
- POS sales transactions
- Reports and analytics
- Authentication and role-based access (Admin/Staff)

## Tech Stack
- Python 3
- Flask
- SQLite
- Vanilla HTML/CSS/JS frontend

## Run
1. Install dependencies:
   ```powershell
   python -m pip install -r requirements.txt
   ```
2. Start app:
   ```powershell
   python app.py
   ```

The app runs on `http://127.0.0.1:5000` and auto-opens your browser when started.

## Default Login
- Username: `admin`
- Password: `admin123`

## Key Behavior
- POS sale automatically deducts inventory stock
- Low-stock alerts shown for stock `<= 10`
- Admin can manage users and delete records
- Staff can manage customers, products, and sales
