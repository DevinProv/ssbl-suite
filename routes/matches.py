from flask import Blueprint, jsonify, request
from database import db
from models import MatchSet, Game

sets_bp = Blueprint("sets", __name__)

def serialize_game(g):
    return {
        "id": g.id,
        "setID": g.setID,
        "gameNumber": g.gameNumber,
        "player1Char": g.player1Char,
        "player2Char": g.player2Char,
        "winnerID": g.winnerID
    }

def serialize_set(s):
    return {
        "id": s.id,
        "eventID": s.eventID,
        "round": s.bracketRound,
        "player1ID": s.player1ID,
        "player2ID": s.player2ID,
        "winnerID": s.winnerID,
        "vodFilename": s.vodFilename,
        "vodTimestampStart": s.vodTimestampStart,
        "vodTimestampEnd": s.vodTimestampEnd,
        "games": [serialize_game(g) for g in s.games]
    }

# Get Sets
@sets_bp.route("/sets", methods=["GET"])
def get_sets():
    sets = MatchSet.query.all()
    return jsonify([serialize_set(s) for s in sets])

# Get Set By ID
@sets_bp.route("/sets/<int:set_id>", methods=["GET"])
def get_set(set_id):
    match_set = MatchSet.query.get(set_id)
    if match_set is None:
        return jsonify({"error": "Set not found"}), 404
    return jsonify(serialize_set(match_set))

# Create Set
@sets_bp.route("/sets", methods=["POST"])
def create_set():
    data = request.get_json()
    if not data or "eventID" not in data or "bracketRound" not in data or "player1ID" not in data or "player2ID" not in data:
        return jsonify({"error": "Invalid request"}), 400
    match_set = MatchSet(
        eventID=data["eventID"],
        bracketRound=data["bracketRound"],
        player1ID=data["player1ID"],
        player2ID=data["player2ID"],
        winnerID=data.get("winnerID"),
        vodFilename=data.get("vodFilename"),
        vodTimestampStart=data.get("vodTimestampStart"),
        vodTimestampEnd=data.get("vodTimestampEnd")
    )
    db.session.add(match_set)
    db.session.commit()
    return jsonify(serialize_set(match_set)), 201

# Update Set
@sets_bp.route("/sets/<int:set_id>", methods=["PUT"])
def update_set(set_id):
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    match_set = MatchSet.query.get(set_id)
    if match_set is None:
        return jsonify({"error": "Set not found"}), 404
    for key, value in data.items():
        if hasattr(match_set, key):
            setattr(match_set, key, value)
    db.session.commit()
    return jsonify(serialize_set(match_set)), 200

# Get Games
@sets_bp.route("/sets/<int:set_id>/games", methods=["GET"])
def get_games(set_id):
    match_set = MatchSet.query.get(set_id)
    if match_set is None:
        return jsonify({"error": "Set not found"}), 404
    return jsonify([serialize_game(g) for g in match_set.games]), 200

# Create Game
@sets_bp.route("/sets/<int:set_id>/games", methods=["POST"])
def create_game(set_id):
    data = request.get_json()
    if not data or "gameNumber" not in data or "winnerID" not in data:
        return jsonify({"error": "Invalid request"}), 400
    match_set = MatchSet.query.get(set_id)
    if match_set is None:
        return jsonify({"error": "Set not found"}), 404
    game = Game(
        setID=set_id,
        gameNumber=data["gameNumber"],
        player1Char=data.get("player1Char"),
        player2Char=data.get("player2Char"),
        winnerID=data["winnerID"]
    )
    db.session.add(game)
    db.session.commit()
    return jsonify(serialize_game(game)), 201

# Delete Game
@sets_bp.route("/sets/<int:set_id>/games/<int:game_id>", methods=["DELETE"])
def delete_game(set_id, game_id):
    game = Game.query.get(game_id)
    if game is None or game.setID != set_id:
        return jsonify({"error": "Game not found"}), 404
    db.session.delete(game)
    db.session.commit()

    match_set = MatchSet.query.get(set_id)
    if match_set and len(match_set.games) == 0:
        db.session.delete(match_set)
        db.session.commit()
        return jsonify({"ok": True, "setDeleted": True})
    return jsonify({"ok": True})

@sets_bp.route("/sets/<int:set_id>/games/last", methods=["DELETE"])
def delete_last_game(set_id):
    """Delete the most recent game in a set — used by undo."""
    match_set = MatchSet.query.get(set_id)
    if match_set is None:
        return jsonify({"error": "Set not found"}), 404
    if not match_set.games:
        return jsonify({"error": "No games to undo"}), 400
    last_game = max(match_set.games, key=lambda g: g.gameNumber)
    winner_id = last_game.winnerID
    db.session.delete(last_game)
    db.session.commit()
    return jsonify({"ok": True, "winnerID": winner_id})