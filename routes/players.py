from flask import Blueprint, jsonify, request
from database import db
from models import Player, MatchSet, Game, GameParticipant, Team
from sqlalchemy.orm.attributes import flag_modified

players_bp = Blueprint("players", __name__)


def serialize_player(p):
    return {
        "id": p.id,
        "name": p.name,
        "defaultChar": p.defaultChar,
        "defaultCharColor": p.defaultCharColor,
        "aliases": p.aliases or [],
    }


def get_player_stats(player_id):
    """
    Compute stats for a player across all modes.
    Returns sets played, wins, losses, win rate.
    Works by checking GameParticipant rows.
    """
    # Singles sets: player is player1ID or player2ID
    singles_sets = MatchSet.query.filter(
        MatchSet.mode == "singles",
        db.or_(MatchSet.player1ID == player_id, MatchSet.player2ID == player_id)
    ).all()

    # Doubles sets: player is on team1 or team2
    doubles_teams = Team.query.filter(
        db.or_(Team.player1ID == player_id, Team.player2ID == player_id)
    ).all()
    team_ids = [t.id for t in doubles_teams]
    doubles_sets = MatchSet.query.filter(
        MatchSet.mode == "doubles",
        db.or_(MatchSet.team1ID.in_(team_ids), MatchSet.team2ID.in_(team_ids))
    ).all() if team_ids else []

    # FFA sets: player appears in GameParticipant
    ffa_game_ids = db.session.query(GameParticipant.gameID).filter(
        GameParticipant.playerID == player_id,
        GameParticipant.teamID == None
    ).subquery()
    ffa_set_ids = db.session.query(Game.setID).filter(
        Game.id.in_(ffa_game_ids)
    ).distinct().subquery()
    ffa_sets = MatchSet.query.filter(
        MatchSet.mode == "ffa",
        MatchSet.id.in_(ffa_set_ids)
    ).all()

    all_sets = singles_sets + doubles_sets + ffa_sets
    total = len(all_sets)

    wins = 0
    for s in singles_sets:
        if s.winnerID == player_id:
            wins += 1
    for s in doubles_sets:
        if s.winnerTeamID and s.winnerTeamID in team_ids:
            wins += 1
    # FFA wins: count sets where player has isWinner=True in any game... 
    # Actually for FFA "set win" = player won the most games. 
    # For now: player won the set if they have the most isWinner games.
    for s in ffa_sets:
        scores = {}
        for g in s.games:
            for gp in g.participants:
                if gp.isWinner:
                    scores[gp.playerID] = scores.get(gp.playerID, 0) + 1
        if scores and max(scores, key=scores.get) == player_id:
            wins += 1

    losses = total - wins
    win_rate = round((wins / total) * 100) if total > 0 else 0

    return {
        "sets": total,
        "wins": wins,
        "losses": losses,
        "winRate": win_rate,
        "singlesCount": len(singles_sets),
        "doublesCount": len(doubles_sets),
        "ffaCount": len(ffa_sets),
    }


@players_bp.route("/players", methods=["GET"])
def get_players():
    players = Player.query.all()
    return jsonify([serialize_player(p) for p in players])

@players_bp.route("/players/<int:player_id>", methods=["GET"])
def get_player(player_id):
    player = Player.query.get(player_id)
    if not player:
        return jsonify({"error": "Player not found"}), 404
    return jsonify(serialize_player(player))

@players_bp.route("/players", methods=["POST"])
def create_player():
    data = request.get_json()
    if not data or "name" not in data:
        return jsonify({"error": "Invalid request"}), 400
    player = Player(
        name=data["name"],
        defaultChar=data.get("defaultChar"),
        defaultCharColor=data.get("defaultCharColor"),
        aliases=data.get("aliases", []),
    )
    db.session.add(player)
    db.session.commit()
    return jsonify(serialize_player(player)), 201

@players_bp.route("/players/<int:player_id>", methods=["PUT"])
def update_player(player_id):
    player = Player.query.get(player_id)
    if not player:
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
    if "aliases" in data:
        player.aliases = data["aliases"]
        flag_modified(player, "aliases")
    db.session.commit()
    return jsonify(serialize_player(player)), 200

@players_bp.route("/players/search", methods=["GET"])
def search_players():
    q = request.args.get("q")
    if not q:
        return jsonify({"error": "q required"}), 400
    players = Player.query.filter(Player.name.ilike(f"%{q}%")).all()
    return jsonify([serialize_player(p) for p in players])

@players_bp.route("/players/<int:player_id>", methods=["DELETE"])
def delete_player(player_id):
    player = Player.query.get(player_id)
    if not player:
        return jsonify({"error": "Player not found"}), 404
    db.session.delete(player)
    db.session.commit()
    return jsonify({"ok": True})

@players_bp.route("/players/<int:player_id>/stats", methods=["GET"])
def player_stats(player_id):
    player = Player.query.get(player_id)
    if not player:
        return jsonify({"error": "Player not found"}), 404
    return jsonify(get_player_stats(player_id))