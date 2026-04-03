from flask import Blueprint, jsonify, request
from database import db
from models import Player

players_bp = Blueprint("players", __name__)

def serialize_player(p):
    return {
        "id": p.id,
        "name": p.name,
        "defaultChar": p.defaultChar,
        "defaultCharColor": p.defaultCharColor
    }

@players_bp.route("/players", methods=["GET"])
def get_players():
    players = Player.query.all()
    return jsonify([serialize_player(p) for p in players])

@players_bp.route("/players/<int:player_id>", methods=["GET"])
def get_player(player_id):
    player = Player.query.get(player_id)
    if player is None:
        return jsonify({"error": "Player not found"}), 404
    return jsonify(serialize_player(player))


@players_bp.route("/players", methods=["POST"])
def create_player():
    data = request.get_json()
    if not data or "name" not in data:
        return jsonify({"error": "Invalid request"}), 400
    player = Player(
        name=data["name"],
        defaultChar=data["defaultChar"],
        defaultCharColor=data["defaultCharColor"]
    )
    db.session.add(player)
    db.session.commit()
    return jsonify(serialize_player(player)), 201
    
@players_bp.route("/players/<int:player_id>", methods=["PUT"])
def update_player(player_id):
    player = Player.query.get(player_id)
    if player is None:
        return jsonify({"error": "Player not found"}), 404
    
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    
    if "name" in data:
        player.name = data["name"]
    if "defaultChar" in data:
        player.defaultChar = data["defaultChar"]
    if "defaultCharColor" in data:
        player.defaultCharColor = data["defaultCharColor"]
        
    db.session.commit()
    return jsonify(serialize_player(player)), 200

#Search Players by Name
@players_bp.route("/players/search" , methods=["GET"])
def search_players():
    name_query = request.args.get("q")
    if not name_query:
        return jsonify({"error": "Name query parameter is required"}), 400
    
    players = Player.query.filter(Player.name.ilike(f"%{name_query}%")).all()
    return jsonify([serialize_player(p) for p in players])


@players_bp.route("/players/<int:player_id>", methods=["DELETE"])
def delete_player(player_id):
    player = Player.query.get(player_id)
    if player is None:
        return jsonify({"error": "Player not found"}), 404
    db.session.delete(player)
    db.session.commit()
    return jsonify({"ok": True})