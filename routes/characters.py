from flask import Blueprint, jsonify, send_file
from logic.charmanager import char_manager

characters_bp = Blueprint("characters", __name__)

@characters_bp.route("/characters", methods=["GET"])
def get_characters():
    return jsonify(char_manager.get_character_names())

@characters_bp.route("/characters/<character_name>/colors", methods=["GET"])
def get_colors(character_name):
    colors = char_manager.get_colors(character_name)
    if not colors:
        return jsonify({"error": "Character not found or has no colors"}), 404
    return jsonify(colors)

@characters_bp.route("/characters/<character_name>/default/image", methods=["GET"])
def get_default_image(character_name):
    """Serve default.png for a character, falling back to first available color."""
    colors = char_manager.get_colors(character_name)
    if not colors:
        return jsonify({"error": "Character not found"}), 404
    color = "default.png" if "default.png" in colors else colors[0]
    asset_path = char_manager.get_asset_path(character_name, color)
    return send_file(asset_path, mimetype="image/png")

@characters_bp.route("/characters/<character_name>/<color_filename>/image", methods=["GET"])
def get_character_image(character_name, color_filename):
    asset_path = char_manager.get_asset_path(character_name, color_filename)
    return send_file(asset_path, mimetype="image/png")

@characters_bp.route("/characters/refresh", methods=["POST"])
def refresh_characters():
    char_manager.refresh()
    return jsonify({"message": "Character data refreshed successfully"})