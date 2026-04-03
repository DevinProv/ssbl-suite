from flask import Blueprint, jsonify, request
from database import db
from models import MatchSet, Game, GameParticipant, Team, Player

sets_bp = Blueprint("sets", __name__)


# =====================
# Serializers
# =====================

def serialize_participant(gp):
    return {
        "id": gp.id,
        "playerID": gp.playerID,
        "playerName": gp.player.name if gp.player else None,
        "teamID": gp.teamID,
        "character": gp.character,
        "isWinner": gp.isWinner,
    }

def serialize_game(g):
    return {
        "id": g.id,
        "setID": g.setID,
        "gameNumber": g.gameNumber,
        "participants": [serialize_participant(p) for p in g.participants],
        # Convenience fields for singles (backwards compat with frontend)
        "winnerID": next((p.playerID for p in g.participants if p.isWinner), None),
        "winnerTeamID": next((p.teamID for p in g.participants if p.isWinner and p.teamID), None),
    }

def serialize_team(t):
    if not t:
        return None
    return {
        "id": t.id,
        "name": t.name,
        "eventID": t.eventID,
        "player1ID": t.player1ID,
        "player1Name": t.player1.name if t.player1 else None,
        "player2ID": t.player2ID,
        "player2Name": t.player2.name if t.player2 else None,
    }

def serialize_set(s):
    return {
        "id": s.id,
        "eventID": s.eventID,
        "round": s.bracketRound,
        "mode": s.mode,
        # singles
        "player1ID": s.player1ID,
        "player2ID": s.player2ID,
        "winnerID": s.winnerID,
        # doubles
        "team1": serialize_team(s.team1),
        "team2": serialize_team(s.team2),
        "winnerTeamID": s.winnerTeamID,
        # shared
        "vodFilename": s.vodFilename,
        "vodTimestampStart": s.vodTimestampStart,
        "vodTimestampEnd": s.vodTimestampEnd,
        "games": [serialize_game(g) for g in s.games],
    }


# =====================
# Sets
# =====================

@sets_bp.route("/sets", methods=["GET"])
def get_sets():
    sets = MatchSet.query.all()
    return jsonify([serialize_set(s) for s in sets])

@sets_bp.route("/sets/<int:set_id>", methods=["GET"])
def get_set(set_id):
    s = MatchSet.query.get(set_id)
    if not s:
        return jsonify({"error": "Set not found"}), 404
    return jsonify(serialize_set(s))

@sets_bp.route("/sets", methods=["POST"])
def create_set():
    data = request.get_json()
    if not data or "eventID" not in data or "bracketRound" not in data:
        return jsonify({"error": "Invalid request"}), 400

    mode = data.get("mode", "singles")

    if mode == "singles":
        if "player1ID" not in data or "player2ID" not in data:
            return jsonify({"error": "Singles requires player1ID and player2ID"}), 400
        s = MatchSet(
            eventID=data["eventID"],
            bracketRound=data["bracketRound"],
            mode="singles",
            player1ID=data["player1ID"],
            player2ID=data["player2ID"],
            winnerID=data.get("winnerID"),
            vodFilename=data.get("vodFilename"),
            vodTimestampStart=data.get("vodTimestampStart"),
            vodTimestampEnd=data.get("vodTimestampEnd"),
        )

    elif mode == "doubles":
        # Expect team objects: {name, player1ID, player2ID} or existing team1ID/team2ID
        t1_data = data.get("team1")
        t2_data = data.get("team2")
        if not t1_data or not t2_data:
            return jsonify({"error": "Doubles requires team1 and team2"}), 400

        team1 = Team(
            name=t1_data["name"],
            eventID=data["eventID"],
            player1ID=t1_data["player1ID"],
            player2ID=t1_data["player2ID"],
        )
        team2 = Team(
            name=t2_data["name"],
            eventID=data["eventID"],
            player1ID=t2_data["player1ID"],
            player2ID=t2_data["player2ID"],
        )
        db.session.add(team1)
        db.session.add(team2)
        db.session.flush()

        s = MatchSet(
            eventID=data["eventID"],
            bracketRound=data["bracketRound"],
            mode="doubles",
            team1ID=team1.id,
            team2ID=team2.id,
            vodFilename=data.get("vodFilename"),
            vodTimestampStart=data.get("vodTimestampStart"),
            vodTimestampEnd=data.get("vodTimestampEnd"),
        )

    elif mode == "ffa":
        s = MatchSet(
            eventID=data["eventID"],
            bracketRound=data["bracketRound"],
            mode="ffa",
            vodFilename=data.get("vodFilename"),
            vodTimestampStart=data.get("vodTimestampStart"),
            vodTimestampEnd=data.get("vodTimestampEnd"),
        )

    else:
        return jsonify({"error": f"Unknown mode: {mode}"}), 400

    db.session.add(s)
    db.session.commit()
    return jsonify(serialize_set(s)), 201

@sets_bp.route("/sets/<int:set_id>", methods=["PUT"])
def update_set(set_id):
    s = MatchSet.query.get(set_id)
    if not s:
        return jsonify({"error": "Set not found"}), 404
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    simple_fields = ["bracketRound", "winnerID", "winnerTeamID",
                     "vodFilename", "vodTimestampStart", "vodTimestampEnd"]
    for field in simple_fields:
        if field in data:
            setattr(s, field, data[field])

    db.session.commit()
    return jsonify(serialize_set(s)), 200


# =====================
# Games
# =====================

@sets_bp.route("/sets/<int:set_id>/games", methods=["GET"])
def get_games(set_id):
    s = MatchSet.query.get(set_id)
    if not s:
        return jsonify({"error": "Set not found"}), 404
    return jsonify([serialize_game(g) for g in s.games])

@sets_bp.route("/sets/<int:set_id>/games", methods=["POST"])
def create_game(set_id):
    """
    Create a game with participants.

    Singles payload:
    {
        "gameNumber": 1,
        "winnerID": 5,
        "participants": [
            {"playerID": 5, "character": "fox.png", "isWinner": true},
            {"playerID": 8, "character": "samus.png", "isWinner": false}
        ]
    }

    Doubles payload:
    {
        "gameNumber": 1,
        "winnerTeamID": 3,
        "participants": [
            {"playerID": 5, "teamID": 3, "character": "fox.png", "isWinner": true},
            {"playerID": 6, "teamID": 3, "character": "samus.png", "isWinner": true},
            {"playerID": 7, "teamID": 4, "character": "falcon.png", "isWinner": false},
            {"playerID": 8, "teamID": 4, "character": "pikachu.png", "isWinner": false}
        ]
    }

    FFA payload:
    {
        "gameNumber": 1,
        "winnerID": 5,
        "participants": [
            {"playerID": 5, "character": "fox.png", "isWinner": true},
            {"playerID": 8, "character": "samus.png", "isWinner": false},
            {"playerID": 9, "character": "falcon.png", "isWinner": false}
        ]
    }
    """
    data = request.get_json()
    s = MatchSet.query.get(set_id)
    if not s:
        return jsonify({"error": "Set not found"}), 404
    if not data or "gameNumber" not in data or "participants" not in data:
        return jsonify({"error": "gameNumber and participants required"}), 400

    game = Game(setID=set_id, gameNumber=data["gameNumber"])
    db.session.add(game)
    db.session.flush()

    for p in data["participants"]:
        gp = GameParticipant(
            gameID=game.id,
            playerID=p["playerID"],
            teamID=p.get("teamID"),
            character=p.get("character"),
            isWinner=p.get("isWinner", False),
        )
        db.session.add(gp)

    db.session.commit()
    return jsonify(serialize_game(game)), 201

@sets_bp.route("/sets/<int:set_id>/games/<int:game_id>", methods=["DELETE"])
def delete_game(set_id, game_id):
    game = Game.query.get(game_id)
    if not game or game.setID != set_id:
        return jsonify({"error": "Game not found"}), 404

    db.session.delete(game)
    db.session.commit()

    # Auto-delete set if no games remain
    s = MatchSet.query.get(set_id)
    if s and len(s.games) == 0:
        db.session.delete(s)
        db.session.commit()
        return jsonify({"ok": True, "setDeleted": True})

    return jsonify({"ok": True, "setDeleted": False})

@sets_bp.route("/sets/<int:set_id>/games/last", methods=["DELETE"])
def delete_last_game(set_id):
    """Delete the most recent game — used by dashboard undo."""
    s = MatchSet.query.get(set_id)
    if not s:
        return jsonify({"error": "Set not found"}), 404
    if not s.games:
        return jsonify({"error": "No games to undo"}), 400

    last_game = max(s.games, key=lambda g: g.gameNumber)

    # Figure out who/what won so the frontend can decrement the right score
    winner_player_id = next((p.playerID for p in last_game.participants if p.isWinner and not p.teamID), None)
    winner_team_id = next((p.teamID for p in last_game.participants if p.isWinner and p.teamID), None)

    db.session.delete(last_game)
    db.session.commit()

    return jsonify({
        "ok": True,
        "winnerID": winner_player_id,
        "winnerTeamID": winner_team_id,
    })


# =====================
# Teams
# =====================

@sets_bp.route("/teams", methods=["POST"])
def create_team():
    data = request.get_json()
    if not data or "name" not in data or "eventID" not in data:
        return jsonify({"error": "name and eventID required"}), 400
    team = Team(
        name=data["name"],
        eventID=data["eventID"],
        player1ID=data["player1ID"],
        player2ID=data["player2ID"],
    )
    db.session.add(team)
    db.session.commit()
    return jsonify(serialize_team(team)), 201

@sets_bp.route("/teams/<int:team_id>", methods=["GET"])
def get_team(team_id):
    team = Team.query.get(team_id)
    if not team:
        return jsonify({"error": "Team not found"}), 404
    return jsonify(serialize_team(team))

@sets_bp.route("/teams/event/<int:event_id>", methods=["GET"])
def get_teams_for_event(event_id):
    teams = Team.query.filter_by(eventID=event_id).all()
    return jsonify([serialize_team(t) for t in teams])