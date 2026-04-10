"""
╔══════════════════════════════════════════════════════════════════════╗
║           HotelHub — Hotel Management System (Flask + MongoDB)       ║
║  Full-stack system with authentication, room CRUD, bookings,         ║
║  checkout, ID proof upload, booking history, and analytics.          ║
╚══════════════════════════════════════════════════════════════════════╝
"""

import os
import hashlib
import uuid
from datetime import datetime
from functools import wraps

from flask import (
    Flask, render_template, request, jsonify,
    session, redirect, url_for, send_from_directory
)
from pymongo import MongoClient
from bson import ObjectId
from werkzeug.utils import secure_filename

# ═══════════════════════════════════════════════════════════════════════
# APP CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════

app = Flask(__name__)
app.secret_key = "hotelhub_secret_key_2026_secure"

# File upload config
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "uploads")
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "pdf", "webp"}
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # 5 MB max

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# ═══════════════════════════════════════════════════════════════════════
# MONGODB CONNECTION
# ═══════════════════════════════════════════════════════════════════════

client = MongoClient("mongodb://localhost:27017/")
db = client["hotel_management"]

users_col = db["users"]
rooms_col = db["rooms"]
bookings_col = db["bookings"]
history_col = db["booking_history"]

# ═══════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════

def hash_password(password):
    """Hash a password with SHA-256."""
    return hashlib.sha256(password.encode()).hexdigest()

def allowed_file(filename):
    """Check if file extension is allowed."""
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

def serialize(doc):
    """Convert MongoDB doc to JSON-serializable dict."""
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc

def serialize_list(docs):
    """Convert list of MongoDB docs."""
    return [serialize(d) for d in docs]

# ── Authentication Decorators ──────────────────────────────────────────

def login_required(f):
    """Decorator: must be logged in."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user" not in session:
            if request.is_json or request.path.startswith("/api"):
                return jsonify({"error": "Authentication required"}), 401
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    """Decorator: must be admin."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user" not in session:
            return jsonify({"error": "Authentication required"}), 401
        if session.get("role") != "admin":
            return jsonify({"error": "Admin access required"}), 403
        return f(*args, **kwargs)
    return decorated

# ═══════════════════════════════════════════════════════════════════════
# PAGE ROUTES
# ═══════════════════════════════════════════════════════════════════════

@app.route("/")
def index():
    """Main dashboard — redirect to login if not authenticated."""
    if "user" not in session:
        return redirect(url_for("login_page"))
    return render_template("index.html",
                           username=session["user"],
                           role=session["role"])

@app.route("/login")
def login_page():
    """Login page."""
    if "user" in session:
        return redirect(url_for("index"))
    return render_template("login.html")

# ═══════════════════════════════════════════════════════════════════════
# AUTH API
# ═══════════════════════════════════════════════════════════════════════

@app.route("/api/login", methods=["POST"])
def api_login():
    """Authenticate user and create session."""
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    user = users_col.find_one({
        "username": username,
        "password": hash_password(password)
    })

    if not user:
        return jsonify({"error": "Invalid username or password"}), 401

    session["user"] = user["username"]
    session["role"] = user["role"]

    return jsonify({
        "message": f"Welcome back, {username}!",
        "role": user["role"]
    })

@app.route("/api/logout", methods=["POST"])
def api_logout():
    """Destroy session."""
    session.clear()
    return jsonify({"message": "Logged out successfully"})

@app.route("/api/me", methods=["GET"])
@login_required
def api_me():
    """Return current user info."""
    return jsonify({
        "username": session["user"],
        "role": session["role"]
    })

# ═══════════════════════════════════════════════════════════════════════
# DASHBOARD API
# ═══════════════════════════════════════════════════════════════════════

@app.route("/api/dashboard", methods=["GET"])
@login_required
def api_dashboard():
    """Return dashboard statistics."""
    total = rooms_col.count_documents({})
    available = rooms_col.count_documents({"status": "available"})
    booked = rooms_col.count_documents({"status": "booked"})
    maintenance = rooms_col.count_documents({"status": "maintenance"})
    total_bookings = bookings_col.count_documents({})
    total_history = history_col.count_documents({})

    # Revenue calculation from history
    pipeline = [{"$group": {"_id": None, "total": {"$sum": "$price"}}}]
    revenue_result = list(history_col.aggregate(pipeline))
    total_revenue = revenue_result[0]["total"] if revenue_result else 0

    # Recent bookings
    recent = list(bookings_col.find().sort("_id", -1).limit(5))

    return jsonify({
        "total_rooms": total,
        "available_rooms": available,
        "booked_rooms": booked,
        "maintenance_rooms": maintenance,
        "total_bookings": total_bookings,
        "total_history": total_history,
        "total_revenue": total_revenue,
        "recent_bookings": serialize_list(recent)
    })

# ═══════════════════════════════════════════════════════════════════════
# ANALYTICS API (Admin Only)
# ═══════════════════════════════════════════════════════════════════════

@app.route("/api/analytics", methods=["GET"])
@admin_required
def api_analytics():
    """Return analytics data for charts."""
    # Room type distribution
    type_pipeline = [{"$group": {"_id": "$type", "count": {"$sum": 1}}}]
    type_data = list(rooms_col.aggregate(type_pipeline))

    # Room status distribution
    status_pipeline = [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
    status_data = list(rooms_col.aggregate(status_pipeline))

    # Monthly bookings from history (last 6 months)
    monthly_pipeline = [
        {"$group": {
            "_id": {"$substr": ["$booked_at", 0, 7]},
            "count": {"$sum": 1},
            "revenue": {"$sum": "$price"}
        }},
        {"$sort": {"_id": 1}},
        {"$limit": 6}
    ]
    monthly_data = list(history_col.aggregate(monthly_pipeline))

    # Revenue by room type from history
    revenue_pipeline = [
        {"$group": {
            "_id": "$room_type",
            "revenue": {"$sum": "$price"},
            "count": {"$sum": 1}
        }}
    ]
    revenue_data = list(history_col.aggregate(revenue_pipeline))

    return jsonify({
        "room_types": type_data,
        "room_status": status_data,
        "monthly_bookings": monthly_data,
        "revenue_by_type": revenue_data
    })

# ═══════════════════════════════════════════════════════════════════════
# ROOMS API
# ═══════════════════════════════════════════════════════════════════════

@app.route("/api/rooms", methods=["GET"])
@login_required
def get_rooms():
    """
    GET /api/rooms
    Query: ?type=&status=&search=
    """
    query = {}
    room_type = request.args.get("type")
    status = request.args.get("status")
    search = request.args.get("search", "").strip()

    if room_type and room_type != "all":
        query["type"] = room_type
    if status and status != "all":
        query["status"] = status
    if search:
        query["room_no"] = {"$regex": search, "$options": "i"}

    rooms = list(rooms_col.find(query).sort("room_no", 1))
    return jsonify(serialize_list(rooms))


@app.route("/api/rooms", methods=["POST"])
@admin_required
def add_room():
    """POST /api/rooms — Add new room (admin only)."""
    data = request.get_json()

    room_no = data.get("room_no", "").strip()
    room_type = data.get("type", "").strip()
    price = data.get("price")

    if not room_no or not room_type or not price:
        return jsonify({"error": "All fields are required"}), 400

    try:
        price = float(price)
        if price <= 0:
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({"error": "Price must be a positive number"}), 400

    # Check duplicate
    if rooms_col.find_one({"room_no": room_no}):
        return jsonify({"error": f"Room {room_no} already exists"}), 409

    room = {
        "room_no": room_no,
        "type": room_type,
        "price": price,
        "status": "available",
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

    rooms_col.insert_one(room)
    return jsonify({"message": f"Room {room_no} added successfully!", "room": serialize(room)}), 201


@app.route("/api/rooms/<room_id>", methods=["PUT"])
@admin_required
def update_room(room_id):
    """PUT /api/rooms/:id — Update room (admin only)."""
    data = request.get_json()

    try:
        existing = rooms_col.find_one({"_id": ObjectId(room_id)})
    except Exception:
        return jsonify({"error": "Invalid room ID"}), 400

    if not existing:
        return jsonify({"error": "Room not found"}), 404

    # Check for duplicate room_no if changed
    new_room_no = data.get("room_no", "").strip()
    if new_room_no and new_room_no != existing["room_no"]:
        if rooms_col.find_one({"room_no": new_room_no}):
            return jsonify({"error": f"Room {new_room_no} already exists"}), 409

    update = {}
    if new_room_no:
        update["room_no"] = new_room_no
    if data.get("type"):
        update["type"] = data["type"]
    if data.get("price"):
        try:
            update["price"] = float(data["price"])
        except (ValueError, TypeError):
            return jsonify({"error": "Invalid price"}), 400
    if data.get("status"):
        update["status"] = data["status"]

    if update:
        rooms_col.update_one({"_id": ObjectId(room_id)}, {"$set": update})

    updated = rooms_col.find_one({"_id": ObjectId(room_id)})
    return jsonify({"message": "Room updated successfully!", "room": serialize(updated)})


@app.route("/api/rooms/<room_id>", methods=["DELETE"])
@admin_required
def delete_room(room_id):
    """DELETE /api/rooms/:id — Delete room (admin only, not if booked)."""
    try:
        room = rooms_col.find_one({"_id": ObjectId(room_id)})
    except Exception:
        return jsonify({"error": "Invalid room ID"}), 400

    if not room:
        return jsonify({"error": "Room not found"}), 404

    if room["status"] == "booked":
        return jsonify({"error": "Cannot delete a booked room. Checkout first."}), 400

    rooms_col.delete_one({"_id": ObjectId(room_id)})
    return jsonify({"message": f"Room {room['room_no']} deleted successfully!"})

# ═══════════════════════════════════════════════════════════════════════
# BOOKINGS API
# ═══════════════════════════════════════════════════════════════════════

@app.route("/api/bookings", methods=["GET"])
@login_required
def get_bookings():
    """GET /api/bookings — List active bookings."""
    bookings = list(bookings_col.find().sort("_id", -1))
    return jsonify(serialize_list(bookings))


@app.route("/api/book", methods=["POST"])
@login_required
def create_booking():
    """POST /api/book — Create booking with optional ID proof upload."""
    # Handle multipart form data (for file upload)
    customer_name = request.form.get("customer_name", "").strip()
    phone = request.form.get("phone", "").strip()
    room_no = request.form.get("room_no", "").strip()
    check_in = request.form.get("check_in", "").strip()
    check_out = request.form.get("check_out", "").strip()

    # Validation
    if not all([customer_name, phone, room_no, check_in, check_out]):
        return jsonify({"error": "All fields are required"}), 400

    if len(phone) < 10:
        return jsonify({"error": "Enter a valid phone number (min 10 digits)"}), 400

    if check_out <= check_in:
        return jsonify({"error": "Check-out must be after check-in date"}), 400

    # Check room availability
    room = rooms_col.find_one({"room_no": room_no})
    if not room:
        return jsonify({"error": f"Room {room_no} not found"}), 404

    if room["status"] != "available":
        return jsonify({"error": f"Room {room_no} is not available ({room['status']})"}), 409

    # Handle ID proof upload
    id_proof_filename = ""
    if "id_proof" in request.files:
        file = request.files["id_proof"]
        if file and file.filename and allowed_file(file.filename):
            # Generate unique filename
            ext = file.filename.rsplit(".", 1)[1].lower()
            unique_name = f"{uuid.uuid4().hex[:12]}_{secure_filename(file.filename)}"
            file.save(os.path.join(app.config["UPLOAD_FOLDER"], unique_name))
            id_proof_filename = unique_name
        elif file and file.filename:
            return jsonify({"error": "Invalid file type. Allowed: PNG, JPG, JPEG, PDF, WEBP"}), 400

    # Create booking
    booking = {
        "customer_name": customer_name,
        "phone": phone,
        "room_no": room_no,
        "room_type": room["type"],
        "price": room["price"],
        "check_in": check_in,
        "check_out": check_out,
        "id_proof": id_proof_filename,
        "booked_by": session.get("user", "unknown"),
        "booked_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

    bookings_col.insert_one(booking)

    # Update room status
    rooms_col.update_one({"room_no": room_no}, {"$set": {"status": "booked"}})

    return jsonify({
        "message": f"Booking confirmed for Room {room_no}!",
        "booking": serialize(booking)
    }), 201


# ═══════════════════════════════════════════════════════════════════════
# CHECKOUT API
# ═══════════════════════════════════════════════════════════════════════

@app.route("/api/bookings/<booking_id>/checkout", methods=["POST"])
@login_required
def checkout(booking_id):
    """POST /api/bookings/:id/checkout — Checkout guest, move to history."""
    try:
        booking = bookings_col.find_one({"_id": ObjectId(booking_id)})
    except Exception:
        return jsonify({"error": "Invalid booking ID"}), 400

    if not booking:
        return jsonify({"error": "Booking not found"}), 404

    # Move to history
    history_entry = {
        "customer_name": booking["customer_name"],
        "phone": booking["phone"],
        "room_no": booking["room_no"],
        "room_type": booking.get("room_type", "N/A"),
        "price": booking.get("price", 0),
        "check_in": booking["check_in"],
        "check_out": booking["check_out"],
        "id_proof": booking.get("id_proof", ""),
        "booked_by": booking.get("booked_by", ""),
        "booked_at": booking.get("booked_at", ""),
        "checked_out_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "checked_out_by": session.get("user", "unknown")
    }

    history_col.insert_one(history_entry)

    # Set room back to available
    rooms_col.update_one(
        {"room_no": booking["room_no"]},
        {"$set": {"status": "available"}}
    )

    # Remove active booking
    bookings_col.delete_one({"_id": ObjectId(booking_id)})

    return jsonify({
        "message": f"Room {booking['room_no']} checked out successfully!",
        "history": serialize(history_entry)
    })

# ═══════════════════════════════════════════════════════════════════════
# BOOKING HISTORY API
# ═══════════════════════════════════════════════════════════════════════

@app.route("/api/history", methods=["GET"])
@login_required
def get_history():
    """GET /api/history — Booking history (completed bookings)."""
    history = list(history_col.find().sort("_id", -1))
    return jsonify(serialize_list(history))

# ═══════════════════════════════════════════════════════════════════════
# FILE SERVING
# ═══════════════════════════════════════════════════════════════════════

@app.route("/uploads/<filename>")
@login_required
def uploaded_file(filename):
    """Serve uploaded ID proof files."""
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

# ═══════════════════════════════════════════════════════════════════════
# SEED DATA
# ═══════════════════════════════════════════════════════════════════════

@app.route("/api/seed", methods=["POST"])
@login_required
def seed_data():
    """Insert sample users, rooms, and bookings."""
    # Clear all collections
    users_col.delete_many({})
    rooms_col.delete_many({})
    bookings_col.delete_many({})
    history_col.delete_many({})

    # ── Users ──────────────────────────────────────────────────────
    users_col.insert_many([
        {"username": "admin", "password": hash_password("1234"), "role": "admin"},
        {"username": "user", "password": hash_password("1234"), "role": "user"},
    ])

    # ── Rooms ──────────────────────────────────────────────────────
    sample_rooms = [
        {"room_no": "101", "type": "AC", "price": 2500, "status": "available",
         "created_at": "2026-04-01 10:00:00"},
        {"room_no": "102", "type": "AC", "price": 2500, "status": "available",
         "created_at": "2026-04-01 10:00:00"},
        {"room_no": "103", "type": "Non-AC", "price": 1500, "status": "available",
         "created_at": "2026-04-01 10:00:00"},
        {"room_no": "104", "type": "Non-AC", "price": 1500, "status": "available",
         "created_at": "2026-04-01 10:00:00"},
        {"room_no": "201", "type": "Deluxe", "price": 5000, "status": "booked",
         "created_at": "2026-04-01 10:00:00"},
        {"room_no": "202", "type": "Deluxe", "price": 5000, "status": "available",
         "created_at": "2026-04-01 10:00:00"},
        {"room_no": "203", "type": "AC", "price": 3000, "status": "booked",
         "created_at": "2026-04-01 10:00:00"},
        {"room_no": "204", "type": "AC", "price": 2800, "status": "maintenance",
         "created_at": "2026-04-01 10:00:00"},
        {"room_no": "301", "type": "Deluxe", "price": 6000, "status": "available",
         "created_at": "2026-04-01 10:00:00"},
        {"room_no": "302", "type": "Non-AC", "price": 1800, "status": "available",
         "created_at": "2026-04-01 10:00:00"},
        {"room_no": "303", "type": "AC", "price": 3200, "status": "available",
         "created_at": "2026-04-01 10:00:00"},
        {"room_no": "304", "type": "Deluxe", "price": 7000, "status": "available",
         "created_at": "2026-04-01 10:00:00"},
    ]
    rooms_col.insert_many(sample_rooms)

    # ── Active Bookings (for booked rooms) ─────────────────────────
    sample_bookings = [
        {
            "customer_name": "Rahul Sharma",
            "phone": "9876543210",
            "room_no": "201",
            "room_type": "Deluxe",
            "price": 5000,
            "check_in": "2026-04-10",
            "check_out": "2026-04-14",
            "id_proof": "",
            "booked_by": "admin",
            "booked_at": "2026-04-09 14:30:00"
        },
        {
            "customer_name": "Anita Desai",
            "phone": "9123456789",
            "room_no": "203",
            "room_type": "AC",
            "price": 3000,
            "check_in": "2026-04-08",
            "check_out": "2026-04-12",
            "id_proof": "",
            "booked_by": "user",
            "booked_at": "2026-04-07 10:15:00"
        }
    ]
    bookings_col.insert_many(sample_bookings)

    # ── Booking History (past completed) ───────────────────────────
    sample_history = [
        {
            "customer_name": "Vikram Singh",
            "phone": "9988776655",
            "room_no": "101",
            "room_type": "AC",
            "price": 2500,
            "check_in": "2026-03-20",
            "check_out": "2026-03-25",
            "id_proof": "",
            "booked_by": "admin",
            "booked_at": "2026-03-19 09:00:00",
            "checked_out_at": "2026-03-25 11:00:00",
            "checked_out_by": "admin"
        },
        {
            "customer_name": "Priya Patel",
            "phone": "9112233445",
            "room_no": "202",
            "room_type": "Deluxe",
            "price": 5000,
            "check_in": "2026-03-28",
            "check_out": "2026-04-02",
            "id_proof": "",
            "booked_by": "user",
            "booked_at": "2026-03-27 16:00:00",
            "checked_out_at": "2026-04-02 10:30:00",
            "checked_out_by": "admin"
        },
        {
            "customer_name": "Meera Joshi",
            "phone": "9001122334",
            "room_no": "103",
            "room_type": "Non-AC",
            "price": 1500,
            "check_in": "2026-04-01",
            "check_out": "2026-04-05",
            "id_proof": "",
            "booked_by": "admin",
            "booked_at": "2026-03-31 14:00:00",
            "checked_out_at": "2026-04-05 12:00:00",
            "checked_out_by": "admin"
        }
    ]
    history_col.insert_many(sample_history)

    return jsonify({
        "message": "Sample data loaded! Login: admin/1234 or user/1234",
        "users": 2, "rooms": len(sample_rooms),
        "bookings": len(sample_bookings), "history": len(sample_history)
    })

# ═══════════════════════════════════════════════════════════════════════
# INITIAL USER SEEDING (runs on startup)
# ═══════════════════════════════════════════════════════════════════════

def ensure_default_users():
    """Create default admin and user accounts if they don't exist."""
    if not users_col.find_one({"username": "admin"}):
        users_col.insert_one({
            "username": "admin",
            "password": hash_password("1234"),
            "role": "admin"
        })
    if not users_col.find_one({"username": "user"}):
        users_col.insert_one({
            "username": "user",
            "password": hash_password("1234"),
            "role": "user"
        })

# ═══════════════════════════════════════════════════════════════════════
# RUN SERVER
# ═══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    ensure_default_users()
    print()
    print("╔══════════════════════════════════════════════════╗")
    print("║     🏨  HotelHub Management System              ║")
    print("║     📡  http://localhost:5000                    ║")
    print("║     🔑  Login: admin/1234 or user/1234          ║")
    print("║     🗄️   Database: hotel_management              ║")
    print("╚══════════════════════════════════════════════════╝")
    print()
    app.run(debug=True, port=5000)
