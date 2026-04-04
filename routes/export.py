from flask import Blueprint, jsonify, request
from database import db
from models import Player, Event, MatchSet, Game, GameParticipant, Team, ClipExport
import json
import os
import base64
import urllib.request
import urllib.error
from datetime import datetime, timezone

export_bp = Blueprint("export", __name__)

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
EXPORT_DIR = os.path.join(BASE_DIR, "static", "export")
SYNC_CONFIG_PATH = os.path.join(BASE_DIR, "static", "sync_config.json")

DEFAULT_SYNC_CONFIG = {
    "github_repo": "",        # e.g. "DevinProv/ssbl-data"
    "github_token": "",       # Personal access token
    "github_branch": "main",
    "auto_sync": False,       # Sync automatically after each end set
}

# =====================
# Config helpers
# =====================
def load_sync_config():
    if os.path.exists(SYNC_CONFIG_PATH):
        with open(SYNC_CONFIG_PATH) as f:
            return json.load(f)
    return DEFAULT_SYNC_CONFIG.copy()

def save_sync_config(data):
    with open(SYNC_CONFIG_PATH, "w") as f:
        json.dump(data, f, indent=2)

# =====================
# Serializers
# =====================
def export_players():
    players = Player.query.all()
    out = []
    for p in players:
        # Compute stats inline
        singles_sets = MatchSet.query.filter(
            MatchSet.mode == "singles",
            db.or_(MatchSet.player1ID == p.id, MatchSet.player2ID == p.id)
        ).all()

        doubles_teams = Team.query.filter(
            db.or_(Team.player1ID == p.id, Team.player2ID == p.id)
        ).all()
        team_ids = [t.id for t in doubles_teams]
        doubles_sets = MatchSet.query.filter(
            MatchSet.mode == "doubles",
            db.or_(MatchSet.team1ID.in_(team_ids), MatchSet.team2ID.in_(team_ids))
        ).all() if team_ids else []

        ffa_game_ids = db.session.query(GameParticipant.gameID).filter(
            GameParticipant.playerID == p.id,
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
        wins = sum(1 for s in singles_sets if s.winnerID == p.id)
        for s in doubles_sets:
            if s.winnerTeamID and s.winnerTeamID in team_ids:
                wins += 1
        for s in ffa_sets:
            scores = {}
            for g in s.games:
                for gp in g.participants:
                    if gp.isWinner:
                        scores[gp.playerID] = scores.get(gp.playerID, 0) + 1
            if scores and max(scores, key=scores.get) == p.id:
                wins += 1

        total = len(all_sets)
        out.append({
            "id": p.id,
            "name": p.name,
            "defaultChar": p.defaultChar,
            "defaultCharColor": p.defaultCharColor,
            "aliases": p.aliases or [],
            "stats": {
                "sets": total,
                "wins": wins,
                "losses": total - wins,
                "winRate": round((wins / total) * 100) if total > 0 else 0,
                "singlesCount": len(singles_sets),
                "doublesCount": len(doubles_sets),
                "ffaCount": len(ffa_sets),
            }
        })
    return out

def export_events():
    events = Event.query.all()
    return [{
        "id": e.id,
        "eventTitle": e.eventTitle,
        "eventDate": e.eventDate,
        "bracketLink": e.bracketLink,
        "bracketSlug": e.bracketSlug,
        "rounds": e.rounds or [],
    } for e in events]

def export_teams():
    teams = Team.query.all()
    return [{
        "id": t.id,
        "name": t.name,
        "eventID": t.eventID,
        "player1ID": t.player1ID,
        "player2ID": t.player2ID,
    } for t in teams]

def export_sets():
    sets = MatchSet.query.all()
    clip_map = {c.setID: c for c in ClipExport.query.all()}
    out = []
    for s in sets:
        s._clip = clip_map.get(s.id)
        out.append({
            "id": s.id,
            "eventID": s.eventID,
            "round": s.bracketRound,
            "mode": s.mode,
            # singles
            "player1ID": s.player1ID,
            "player2ID": s.player2ID,
            "winnerID": s.winnerID,
            # doubles
            "team1ID": s.team1ID,
            "team2ID": s.team2ID,
            "winnerTeamID": s.winnerTeamID,
            # vod
            "vodFilename": os.path.basename(s.vodFilename) if s.vodFilename else None,
            "vodTimestampStart": s.vodTimestampStart,
            "vodTimestampEnd": s.vodTimestampEnd,
            # clip export
            "youtubeUrl": s._clip.youtube_url if s._clip else None,
            "youtubeId": s._clip.youtube_id if s._clip else None,
        })
    return out

def export_games():
    games = Game.query.all()
    out = []
    for g in games:
        out.append({
            "id": g.id,
            "setID": g.setID,
            "gameNumber": g.gameNumber,
            "participants": [{
                "playerID": gp.playerID,
                "teamID": gp.teamID,
                "character": gp.character,
                "isWinner": gp.isWinner,
            } for gp in g.participants],
        })
    return out

def build_export():
    """Build the full export payload."""
    return {
        "meta": {
            "exportedAt": datetime.now(timezone.utc).isoformat(),
            "version": "1.0",
        },
        "players": export_players(),
        "events": export_events(),
        "teams": export_teams(),
        "sets": export_sets(),
        "games": export_games(),
    }

def write_export_files(data):
    """Write export JSON files to static/export/."""
    os.makedirs(EXPORT_DIR, exist_ok=True)
    files = {
        "meta.json": data["meta"],
        "players.json": data["players"],
        "events.json": data["events"],
        "teams.json": data["teams"],
        "sets.json": data["sets"],
        "games.json": data["games"],
        "full.json": data,  # combined for convenience
    }
    for filename, content in files.items():
        with open(os.path.join(EXPORT_DIR, filename), "w") as f:
            json.dump(content, f, indent=2)
    return list(files.keys())

# =====================
# GitHub sync
# =====================
def github_api(method, path, token, body=None):
    """Make a GitHub API request."""
    url = f"https://api.github.com{path}"
    payload = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "SSBL-App/1.0",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read()), None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        return None, f"HTTP {e.code}: {body[:300]}"
    except Exception as e:
        return None, str(e)

def get_file_sha(repo, path, token, branch):
    """Get the SHA of an existing file (needed for updates)."""
    data, err = github_api("GET", f"/repos/{repo}/contents/{path}?ref={branch}", token)
    if err or not data:
        return None
    return data.get("sha")

def push_file_to_github(repo, path, content_str, token, branch, commit_message):
    """Create or update a file in a GitHub repo."""
    content_b64 = base64.b64encode(content_str.encode("utf-8")).decode("utf-8")
    sha = get_file_sha(repo, path, token, branch)
    body = {
        "message": commit_message,
        "content": content_b64,
        "branch": branch,
    }
    if sha:
        body["sha"] = sha
    return github_api("PUT", f"/repos/{repo}/contents/{path}", token, body)

def sync_to_github(data, cfg):
    """Push all export files to GitHub."""
    repo = cfg.get("github_repo", "").strip()
    token = cfg.get("github_token", "").strip()
    branch = cfg.get("github_branch", "main").strip() or "main"

    if not repo or not token:
        return False, "GitHub repo or token not configured."

    exported_at = data["meta"]["exportedAt"]
    commit_msg = f"SSBL data sync — {exported_at[:10]}"

    files = {
        "data/meta.json": data["meta"],
        "data/players.json": data["players"],
        "data/events.json": data["events"],
        "data/teams.json": data["teams"],
        "data/sets.json": data["sets"],
        "data/games.json": data["games"],
        "data/full.json": data,
    }

    errors = []
    for filepath, content in files.items():
        content_str = json.dumps(content, indent=2)
        _, err = push_file_to_github(repo, filepath, content_str, token, branch, commit_msg)
        if err:
            errors.append(f"{filepath}: {err}")

    if errors:
        return False, f"Some files failed: {'; '.join(errors)}"
    return True, f"Synced {len(files)} files to {repo}"

# =====================
# Routes
# =====================
@export_bp.route("/sync/config", methods=["GET"])
def get_sync_config():
    cfg = load_sync_config()
    # Mask token
    masked = {**cfg, "github_token": "••••••••" if cfg.get("github_token") else ""}
    return jsonify(masked)

@export_bp.route("/sync/config", methods=["POST"])
def save_sync_config_route():
    data = request.get_json()
    cfg = load_sync_config()
    if "github_repo" in data:
        cfg["github_repo"] = data["github_repo"]
    if "github_branch" in data:
        cfg["github_branch"] = data["github_branch"]
    if "auto_sync" in data:
        cfg["auto_sync"] = data["auto_sync"]
    # Only update token if a new one was provided (not the masked placeholder)
    if data.get("github_token") and data["github_token"] != "••••••••":
        cfg["github_token"] = data["github_token"]
    save_sync_config(cfg)
    return jsonify({"ok": True})

@export_bp.route("/sync/export", methods=["POST"])
def do_export():
    """Generate and write export files locally."""
    data = build_export()
    files = write_export_files(data)
    return jsonify({"ok": True, "files": files, "exportedAt": data["meta"]["exportedAt"]})

@export_bp.route("/sync/push", methods=["POST"])
def do_push():
    """Generate export and push to GitHub."""
    cfg = load_sync_config()
    data = build_export()
    write_export_files(data)
    ok, message = sync_to_github(data, cfg)
    if not ok:
        return jsonify({"ok": False, "error": message}), 400
    return jsonify({"ok": True, "message": message, "exportedAt": data["meta"]["exportedAt"]})

@export_bp.route("/sync/status", methods=["GET"])
def sync_status():
    """Return last export time and config status."""
    cfg = load_sync_config()
    meta_path = os.path.join(EXPORT_DIR, "meta.json")
    last_export = None
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            meta = json.load(f)
        last_export = meta.get("exportedAt")
    return jsonify({
        "configured": bool(cfg.get("github_repo") and cfg.get("github_token")),
        "repo": cfg.get("github_repo", ""),
        "branch": cfg.get("github_branch", "main"),
        "auto_sync": cfg.get("auto_sync", False),
        "last_export": last_export,
    })