"""Focus Studio: a single-user, localhost Python study companion."""
from __future__ import annotations

import csv
import io
import json
import math
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from uuid import UUID

from flask import Flask, g, jsonify, render_template, request, Response

DEFAULTS = {"study": 50, "shortBreak": 15, "longBreak": 30, "longEvery": 4,
            "goal": 180, "sound": True, "phoneTracking": True, "sensitivity": 1.0}


def create_app(database=None):
    app = Flask(__name__)
    app.config.update(DATABASE=str(database or Path(__file__).parent / "instance" / "focus.sqlite3"),
                      MAX_CONTENT_LENGTH=32 * 1024, TEMPLATES_AUTO_RELOAD=True)
    Path(app.config["DATABASE"]).parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(app.config["DATABASE"]) as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, started_at TEXT NOT NULL, local_day TEXT NOT NULL,
                subject TEXT NOT NULL, intention TEXT NOT NULL, duration REAL NOT NULL,
                focused REAL NOT NULL, distracted REAL NOT NULL, unknown REAL NOT NULL,
                manual REAL NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL
            );
        """)

    def db():
        if "db" not in g:
            g.db = sqlite3.connect(app.config["DATABASE"], timeout=10)
            g.db.row_factory = sqlite3.Row
        return g.db

    @app.teardown_appcontext
    def close_db(_error):
        connection = g.pop("db", None)
        if connection:
            connection.close()

    @app.before_request
    def local_access():
        # Avoid exposing a personal, unauthenticated database via DNS rebinding or cross-site writes.
        host = request.host.split(":")[0]
        if host not in {"localhost", "127.0.0.1"}:
            return jsonify(error="Open this app using localhost or 127.0.0.1."), 403
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("Origin")
            if origin and origin != request.host_url.rstrip("/"):
                return jsonify(error="Cross-site requests are not allowed."), 403
            if request.headers.get("Sec-Fetch-Site") == "cross-site":
                return jsonify(error="Cross-site requests are not allowed."), 403

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(self), microphone=()"
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.errorhandler(400)
    def bad_request(_error):
        return jsonify(error="Send a valid JSON object."), 400

    @app.errorhandler(413)
    def too_large(_error):
        return jsonify(error="Request is too large."), 413

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/health")
    def health():
        return jsonify(app="focus-studio", status="ok")

    @app.get("/api/settings")
    def settings_get():
        row = db().execute("SELECT value FROM settings WHERE id=1").fetchone()
        return jsonify(DEFAULTS | (json.loads(row["value"]) if row else {}))

    @app.put("/api/settings")
    def settings_put():
        data = request.get_json()
        if not isinstance(data, dict) or set(data) != set(DEFAULTS):
            return jsonify(error="Provide all supported settings."), 400
        limits = {"study": (1, 180), "shortBreak": (1, 60), "longBreak": (1, 120),
                  "longEvery": (1, 12), "goal": (1, 720), "sensitivity": (.6, 1.6)}
        for key, (low, high) in limits.items():
            value = data[key]
            if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
                return jsonify(error=f"{key} must be between {low} and {high}."), 400
            if key != "sensitivity" and not float(value).is_integer():
                return jsonify(error=f"{key} must be a whole number."), 400
        if any(type(data[key]) is not bool for key in ("sound", "phoneTracking")):
            return jsonify(error="Sound and phone tracking must be true or false."), 400
        with db():
            db().execute("INSERT INTO settings VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
                         (json.dumps(data),))
        return jsonify(data)

    @app.get("/api/sessions")
    def sessions_get():
        day = request.args.get("day")
        query = "SELECT * FROM sessions"
        args = ()
        if day:
            try:
                datetime.strptime(day, "%Y-%m-%d")
            except ValueError:
                return jsonify(error="Use a YYYY-MM-DD day."), 400
            query += " WHERE local_day=?"
            args = (day,)
        rows = db().execute(query + " ORDER BY started_at DESC LIMIT 500", args).fetchall()
        return jsonify([dict(row) for row in rows])

    @app.put("/api/sessions/<session_id>")
    def sessions_put(session_id):
        try:
            UUID(session_id)
        except ValueError:
            return jsonify(error="Invalid session ID."), 400
        data = request.get_json()
        if not isinstance(data, dict):
            return jsonify(error="Provide a session object."), 400
        try:
            started = datetime.fromisoformat(data["started_at"].replace("Z", "+00:00"))
            if started.tzinfo is None:
                raise ValueError("Timestamp needs a time zone.")
            datetime.strptime(data["local_day"], "%Y-%m-%d")
            for key, limit in (("subject", 100), ("intention", 300)):
                if not isinstance(data[key], str) or len(data[key]) > limit:
                    raise ValueError(f"{key} is too long.")
            for key in ("duration", "focused", "distracted", "unknown", "manual"):
                value = data[key]
                if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 10800:
                    raise ValueError("Invalid session duration.")
            if abs(data["focused"] + data["distracted"] + data["unknown"] - data["duration"]) > .05:
                raise ValueError("Attention totals must equal study time.")
            if data["manual"] > data["duration"]:
                raise ValueError("Manual time cannot exceed study time.")
            if data["status"] not in {"active", "completed", "ended"}:
                raise ValueError("Invalid session status.")
        except (KeyError, TypeError, ValueError, AttributeError) as error:
            return jsonify(error=str(error) or "Invalid session."), 400
        with db():
            old = db().execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
            if old:
                if any(data[key] < old[key] - .01 for key in ("duration", "focused", "distracted", "unknown", "manual")):
                    return jsonify(error="A newer snapshot is already saved."), 409
                if old["status"] != "active" and data["status"] == "active":
                    return jsonify(error="This session has already ended."), 409
                if old["started_at"] != data["started_at"] or old["local_day"] != data["local_day"]:
                    return jsonify(error="Session start cannot change."), 409
            fields = ("started_at", "local_day", "subject", "intention", "duration", "focused", "distracted",
                      "unknown", "manual", "status")
            values = [session_id] + [data[key] for key in fields] + [datetime.now().astimezone().isoformat()]
            db().execute("""INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET subject=excluded.subject, intention=excluded.intention,
                duration=excluded.duration, focused=excluded.focused, distracted=excluded.distracted,
                unknown=excluded.unknown, manual=excluded.manual, status=excluded.status, updated_at=excluded.updated_at""", values)
        return jsonify(saved=True)

    @app.get("/api/export")
    def export():
        rows = db().execute("SELECT * FROM sessions ORDER BY started_at DESC").fetchall()
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        writer.writerow(["Started", "Local day", "Subject", "Intention", "Study minutes", "Focused minutes",
                         "Distracted minutes", "Unobserved minutes", "Manual minutes", "Status"])
        for row in rows:
            # Prevent spreadsheet formula execution when opening user-supplied titles in Excel.
            safe = lambda text: "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text
            writer.writerow([row["started_at"], row["local_day"], safe(row["subject"]), safe(row["intention"]),
                             *[round(row[key] / 60, 3) for key in ("duration", "focused", "distracted", "unknown", "manual")],
                             row["status"]])
        return Response(output.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": 'attachment; filename="focus-studio-sessions.csv"'})

    return app


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=int(os.environ.get("PORT", "5050")), debug=False)
