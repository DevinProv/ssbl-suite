from flask import Blueprint, jsonify, request
from config import THEMES_PATH
import json

settings_bp = Blueprint("settings", __name__)

@settings_bp.route("/theme", methods=["POST"])
def set_theme():
    data = request.get_json()
    with open(THEMES_PATH, "r") as f:
        themes = json.load(f)
    themes["active"] = data.get("active", themes["active"])
    with open(THEMES_PATH, "w") as f:
        json.dump(themes, f, indent=2)
    return jsonify({"ok": True})

@settings_bp.route("/theme", methods=["GET"])
def get_theme():
    with open(THEMES_PATH, "r") as f:
        themes = json.load(f)
    return jsonify({"active": themes.get("active", "midnight_arena")})