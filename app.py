import secrets
import sys
import os
import json
import threading
import urllib.request
import ssl
import hashlib
from flask import Flask, render_template, jsonify, request
from flask_sock import Sock
from database import db
from routes import players_bp, events_bp, sets_bp, characters_bp, obs_bp, settings_bp, video_bp, events_mgmt_bp, export_bp, setup_bp
from routes.overlay import overlay_bp, broadcast_scene_change
from config import get_active_theme, get_obs_config
from paths import resource_path, user_data_path, seed_user_data, FROZEN

# Copy bundled default config (theme.json) out next to the exe on first launch.
seed_user_data()

# Make HTTPS certificate verification work inside the PyInstaller bundle (where
# the system trust store is often unavailable) WITHOUT disabling validation.
try:
    import certifi
    _CA_FILE = certifi.where()
except Exception:
    _CA_FILE = None

def _make_ssl_context():
    return ssl.create_default_context(cafile=_CA_FILE)

ssl._create_default_https_context = _make_ssl_context

os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"


try:
    from packaging import version as pkg_version
    HAS_PACKAGING = True
except ImportError:
    HAS_PACKAGING = False

# =====================
# Version / Update config
# =====================
CURRENT_VERSION = "1.0.3"
GITHUB_REPO = "DevinProv/ssbl-suite"   # your app repo (for updates)
DATA_REPO = ""                          # set at runtime from sync config

app = Flask(
    __name__,
    template_folder=resource_path("templates"),
    static_folder=resource_path("static"),
)
# Keep the DB next to the exe so imported data survives restarts/auto-updates.
_db_uri = "sqlite:///" + user_data_path("ssbl.db") if FROZEN else "sqlite:///ssbl.db"
app.config["SQLALCHEMY_DATABASE_URI"] = _db_uri
app._update_pending = None             # path to _update.bat when ready

db.init_app(app)
sock = Sock(app)
app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)

# =====================
# Blueprints
# =====================
app.register_blueprint(players_bp, url_prefix="/api")
app.register_blueprint(events_bp, url_prefix="/api")
app.register_blueprint(sets_bp, url_prefix="/api")
app.register_blueprint(characters_bp, url_prefix="/api")
app.register_blueprint(obs_bp, url_prefix="/api")
app.register_blueprint(settings_bp, url_prefix="/api")
app.register_blueprint(overlay_bp)
app.register_blueprint(video_bp, url_prefix="/api")
app.register_blueprint(events_mgmt_bp, url_prefix="/api")
app.register_blueprint(export_bp, url_prefix="/api")
app.register_blueprint(setup_bp, url_prefix="/api")

@app.context_processor
def inject_theme():
    return {"theme": get_active_theme()}

# =====================
# Page routes
# =====================
@app.route("/")
def index():
    return render_template("dashboard.html")

@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html")

@app.route("/players")
def players_page():
    return render_template("players.html")

@app.route("/settings")
def settings_page():
    return render_template("settings.html")

@app.route("/video")
def video_page():
    return render_template("video.html")

@app.route("/events")
def events_page():
    return render_template("events_mgmt.html")

# =====================
# WebSocket
# =====================
@sock.route("/ws/overlay")
def overlay_ws(ws):
    from routes.overlay import _current_state, _connected_overlays, _overlays_lock, load_config

    config = load_config()

    with _overlays_lock:
        _connected_overlays.add(ws)

    try:
        ws.send(json.dumps({"type": "config", "data": config}))
        ws.send(json.dumps({"type": "state",  "data": _current_state}))

        active = _current_state.get("active_scene") or config.get("active_scene")
        if active:
            ws.send(json.dumps({
                "type": "scene_change",
                "scene": active,
                "data": config,
            }))
    except Exception:
        with _overlays_lock:
            _connected_overlays.discard(ws)
        return

    try:
        while True:
            msg = ws.receive(timeout=30)
            if msg is None:
                break
    except Exception:
        pass
    finally:
        with _overlays_lock:
            _connected_overlays.discard(ws)

# =====================
# Auto-update logic
# =====================
def _version_parts(v):
    """Parse a dotted version into a list of leading-integer components."""
    out = []
    for chunk in v.lstrip("v").split("."):
        digits = ""
        for ch in chunk:
            if ch.isdigit():
                digits += ch
            else:
                break
        out.append(int(digits) if digits else 0)
    return out

def _version_is_newer(latest_str, current_str):
    """Return True if latest > current."""
    if HAS_PACKAGING:
        try:
            return pkg_version.parse(latest_str) > pkg_version.parse(current_str)
        except Exception:
            pass
    return _version_parts(latest_str) > _version_parts(current_str)

def _fetch_text(url):
    """Fetch a small text resource (e.g. a checksum file) over verified HTTPS."""
    req = urllib.request.Request(url, headers={"User-Agent": "SSBL-App"})
    with urllib.request.urlopen(req, timeout=10, context=_make_ssl_context()) as r:
        return r.read().decode("utf-8", "replace")

def _parse_sha256(text, filename):
    """Pull the expected hex digest for `filename` out of a checksum file.

    Handles both a bare-digest sidecar and multi-entry `<hash>  <name>` files.
    """
    target = os.path.basename(filename).lower()
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for ln in lines:
        parts = ln.split()
        if len(parts) >= 2:
            name = os.path.basename(parts[-1].lstrip("*")).lower()
            if name == target:
                return parts[0].lower()
    if len(lines) == 1:
        token = lines[0].split()[0].lower()
        if len(token) == 64 and all(c in "0123456789abcdef" for c in token):
            return token
    return None

def _expected_sha256_for(asset_name, assets):
    """Locate and parse a published SHA-256 for the given release asset."""
    sidecar = next(
        (a for a in assets if a["name"].lower() == f"{asset_name}.sha256".lower()),
        None,
    )
    if not sidecar:
        sidecar = next(
            (a for a in assets if a["name"].lower() in (
                "sha256sums", "sha256sums.txt", "checksums.txt", "checksums.sha256",
            )),
            None,
        )
    if not sidecar:
        return None
    return _parse_sha256(_fetch_text(sidecar["browser_download_url"]), asset_name)

def check_for_update():
    """Background thread: check GitHub Releases for a newer exe."""
    try:
        url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
        req = urllib.request.Request(url, headers={"User-Agent": "SSBL-App"})
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read())

        latest = data["tag_name"].lstrip("v")
        if not _version_is_newer(latest, CURRENT_VERSION):
            print(f"[Update] Already on latest ({CURRENT_VERSION})")
            return

        assets = data.get("assets", [])
        exe_asset = next((a for a in assets if a["name"].endswith(".exe")), None)
        if not exe_asset:
            print("[Update] No exe asset found in release")
            return

        # Require a published checksum so we never execute an unverified binary.
        expected_sha = _expected_sha256_for(exe_asset["name"], assets)
        if not expected_sha:
            print("[Update] No SHA-256 checksum published for the release asset — "
                  "refusing to auto-update.")
            print("[Update] Publish '<exe>.sha256' or a 'SHA256SUMS' asset alongside "
                  "the .exe to enable updates.")
            return

        print(f"[Update] New version {latest} found — downloading + verifying...")
        _do_update(exe_asset["browser_download_url"], latest, expected_sha)

    except Exception as e:
        print(f"[Update] Check failed: {e}")

def _do_update(download_url, latest_version, expected_sha256):
    """Download the new exe, verify its checksum, and stage a batch-swap script."""
    # Only meaningful when running as a PyInstaller bundle
    if not getattr(sys, "frozen", False):
        print(f"[Update] Running from source — skipping exe swap (would install {latest_version})")
        app._update_pending = "__source__"
        return

    current_exe = sys.executable
    new_exe = current_exe + ".new"
    backup_exe = current_exe + ".bak"
    bat = os.path.join(os.path.dirname(current_exe), "_update.bat")

    try:
        # Stream over the verified SSL context, hashing as we go.
        sha = hashlib.sha256()
        req = urllib.request.Request(download_url, headers={"User-Agent": "SSBL-App"})
        with urllib.request.urlopen(req, timeout=60, context=_make_ssl_context()) as r, \
                open(new_exe, "wb") as out:
            for chunk in iter(lambda: r.read(65536), b""):
                out.write(chunk)
                sha.update(chunk)

        actual = sha.hexdigest().lower()
        if actual != expected_sha256.lower():
            raise ValueError(
                f"checksum mismatch (expected {expected_sha256}, got {actual})"
            )

        with open(bat, "w") as f:
            f.write(
                f"@echo off\r\n"
                f"timeout /t 2 /nobreak > nul\r\n"
                f"move /y \"{current_exe}\" \"{backup_exe}\"\r\n"
                f"move /y \"{new_exe}\" \"{current_exe}\"\r\n"
                f"start \"\" \"{current_exe}\"\r\n"
                f"del \"%~f0\"\r\n"
            )

        app._update_pending = bat
        app._update_version = latest_version
        print(f"[Update] Staged — will apply on restart")

    except Exception as e:
        print(f"[Update] Download failed: {e}")
        if os.path.exists(new_exe):
            try:
                os.remove(new_exe)
            except Exception:
                pass

# =====================
# Update API routes
# =====================
@app.route("/api/update/status")
def update_status():
    pending = app._update_pending
    return jsonify({
        "current_version": CURRENT_VERSION,
        "update_available": bool(pending),
        "new_version": getattr(app, "_update_version", None) if pending else None,
    })

@app.route("/api/update/apply", methods=["POST"])
def apply_update():
    bat = app._update_pending
    if not bat:
        return jsonify({"error": "No update pending"}), 400
    if bat == "__source__":
        return jsonify({"error": "Running from source — update manually via git"}), 400
    if not os.path.exists(bat):
        return jsonify({"error": "Update script missing — re-check for updates"}), 400

    import subprocess
    subprocess.Popen(["cmd", "/c", bat], shell=False,
                     creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0)
    os.kill(os.getpid(), 9)

# =====================
# GitHub data-import routes
# =====================
def _fetch_github_json(raw_url):
    """Fetch a JSON file from raw.githubusercontent.com."""
    req = urllib.request.Request(raw_url, headers={"User-Agent": "SSBL-App"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

def _build_raw_base(repo, branch="main"):
    return f"https://raw.githubusercontent.com/{repo}/{branch}/data"

@app.route("/api/import/preview", methods=["POST"])
def import_preview():
    """
    Fetch the remote full.json and return a summary so the UI can show
    what would be imported before committing anything to the DB.
    """
    data = request.get_json() or {}
    repo   = data.get("repo", "").strip()
    branch = data.get("branch", "main").strip() or "main"

    if not repo:
        # Fall back to the configured sync repo
        from routes.export import load_sync_config
        cfg = load_sync_config()
        repo = cfg.get("github_repo", "").strip()

    if not repo:
        return jsonify({"error": "No GitHub repo configured. Pass repo or configure Data Sync in Settings."}), 400

    try:
        base = _build_raw_base(repo, branch)
        full = _fetch_github_json(f"{base}/full.json")
    except Exception as e:
        return jsonify({"error": f"Failed to fetch data from {repo}: {e}"}), 400

    meta    = full.get("meta", {})
    players = full.get("players", [])
    events  = full.get("events", [])
    sets    = full.get("sets", [])
    games   = full.get("games", [])

    return jsonify({
        "ok": True,
        "repo": repo,
        "branch": branch,
        "meta": meta,
        "summary": {
            "players": len(players),
            "events":  len(events),
            "sets":    len(sets),
            "games":   len(games),
        },
        # Send back the data so the frontend can pass it straight to /execute
        # without a second network round-trip.
        "data": full,
    })

@app.route("/api/import/execute", methods=["POST"])
def import_execute():
    """
    Import players, events, sets and games from a previously-fetched payload.
    Strategy: upsert by ID — existing rows are updated, new rows are created.
    Games/participants are replaced wholesale for each set that exists in the
    incoming payload.
    """
    from models import Player, Event, MatchSet, Game, GameParticipant, Team, ClipExport
    from sqlalchemy.orm.attributes import flag_modified

    body = request.get_json() or {}
    full = body.get("data")

    if not full:
        # If the client didn't embed the data, re-fetch it
        repo   = body.get("repo", "").strip()
        branch = body.get("branch", "main").strip() or "main"
        if not repo:
            from routes.export import load_sync_config
            cfg = load_sync_config()
            repo = cfg.get("github_repo", "").strip()
        if not repo:
            return jsonify({"error": "No data or repo provided"}), 400
        try:
            base = _build_raw_base(repo, branch)
            full = _fetch_github_json(f"{base}/full.json")
        except Exception as e:
            return jsonify({"error": f"Failed to fetch: {e}"}), 400

    players_data = full.get("players", [])
    events_data  = full.get("events",  [])
    teams_data   = full.get("teams",   [])
    sets_data    = full.get("sets",    [])
    games_data   = full.get("games",   [])

    stats = {"players": 0, "events": 0, "teams": 0, "sets": 0, "games": 0}

    # ── Players ──────────────────────────────────────────────
    for p in players_data:
        existing = db.session.get(Player, p["id"])
        if existing:
            existing.name             = p["name"]
            existing.defaultChar      = p.get("defaultChar")
            existing.defaultCharColor = p.get("defaultCharColor")
            existing.aliases          = p.get("aliases", [])
            flag_modified(existing, "aliases")
        else:
            db.session.add(Player(
                id=p["id"],
                name=p["name"],
                defaultChar=p.get("defaultChar"),
                defaultCharColor=p.get("defaultCharColor"),
                aliases=p.get("aliases", []),
            ))
        stats["players"] += 1

    db.session.flush()

    # ── Events ───────────────────────────────────────────────
    for e in events_data:
        existing = db.session.get(Event, e["id"])
        if existing:
            existing.eventTitle  = e["eventTitle"]
            existing.eventDate   = e.get("eventDate", "")
            existing.bracketLink = e.get("bracketLink")
            existing.bracketSlug = e.get("bracketSlug")
            existing.rounds      = e.get("rounds", [])
            flag_modified(existing, "rounds")
        else:
            db.session.add(Event(
                id=e["id"],
                eventTitle=e["eventTitle"],
                eventDate=e.get("eventDate", ""),
                bracketLink=e.get("bracketLink"),
                bracketSlug=e.get("bracketSlug"),
                rounds=e.get("rounds", []),
            ))
        stats["events"] += 1

    db.session.flush()

    # ── Teams ────────────────────────────────────────────────
    for t in teams_data:
        existing = db.session.get(Team, t["id"])
        if existing:
            existing.name      = t["name"]
            existing.eventID   = t["eventID"]
            existing.player1ID = t["player1ID"]
            existing.player2ID = t["player2ID"]
        else:
            db.session.add(Team(
                id=t["id"],
                name=t["name"],
                eventID=t["eventID"],
                player1ID=t["player1ID"],
                player2ID=t["player2ID"],
            ))
        stats["teams"] += 1

    db.session.flush()

    # ── Sets ─────────────────────────────────────────────────
    for s in sets_data:
        existing = db.session.get(MatchSet, s["id"])
        if existing:
            existing.eventID            = s["eventID"]
            existing.bracketRound       = s.get("round", "")
            existing.mode               = s.get("mode", "singles")
            existing.player1ID          = s.get("player1ID")
            existing.player2ID          = s.get("player2ID")
            existing.winnerID           = s.get("winnerID")
            existing.team1ID            = s.get("team1ID")
            existing.team2ID            = s.get("team2ID")
            existing.winnerTeamID       = s.get("winnerTeamID")
            existing.vodFilename        = s.get("vodFilename")
            existing.vodTimestampStart  = s.get("vodTimestampStart")
            existing.vodTimestampEnd    = s.get("vodTimestampEnd")
        else:
            db.session.add(MatchSet(
                id=s["id"],
                eventID=s["eventID"],
                bracketRound=s.get("round", ""),
                mode=s.get("mode", "singles"),
                player1ID=s.get("player1ID"),
                player2ID=s.get("player2ID"),
                winnerID=s.get("winnerID"),
                team1ID=s.get("team1ID"),
                team2ID=s.get("team2ID"),
                winnerTeamID=s.get("winnerTeamID"),
                vodFilename=s.get("vodFilename"),
                vodTimestampStart=s.get("vodTimestampStart"),
                vodTimestampEnd=s.get("vodTimestampEnd"),
            ))

        # Restore YouTube clip metadata if present
        yt_url = s.get("youtubeUrl")
        yt_id  = s.get("youtubeId")
        if yt_url or yt_id:
            clip = ClipExport.query.filter_by(setID=s["id"]).first()
            if not clip:
                clip = ClipExport(setID=s["id"], status="uploaded")
                db.session.add(clip)
            clip.youtube_url = yt_url
            clip.youtube_id  = yt_id
            clip.status      = "uploaded"

        stats["sets"] += 1

    db.session.flush()

    # ── Games ────────────────────────────────────────────────
    # Group by setID so we can do a wholesale replace per set
    games_by_set = {}
    for g in games_data:
        games_by_set.setdefault(g["setID"], []).append(g)

    for set_id, glist in games_by_set.items():
        # Delete existing games for this set (participants cascade)
        Game.query.filter_by(setID=set_id).delete()
        db.session.flush()

        for g in glist:
            game = Game(id=g["id"], setID=g["setID"], gameNumber=g["gameNumber"])
            db.session.add(game)
            db.session.flush()

            for gp in g.get("participants", []):
                db.session.add(GameParticipant(
                    gameID=game.id,
                    playerID=gp["playerID"],
                    teamID=gp.get("teamID"),
                    character=gp.get("character"),
                    isWinner=gp.get("isWinner", False),
                ))
            stats["games"] += 1

    db.session.commit()

    return jsonify({
        "ok": True,
        "imported": stats,
        "exportedAt": full.get("meta", {}).get("exportedAt"),
    })

# =====================
# DB init + startup tasks
# =====================
with app.app_context():
    import models  # noqa F401
    db.create_all()

    obs_cfg = get_obs_config()
    if obs_cfg.get("host") and obs_cfg.get("password"):
        from logic.obsmanager import obs_manager
        success = obs_manager.connect(
            obs_cfg["host"],
            obs_cfg.get("port", 4455),
            obs_cfg["password"]
        )
        if success:
            obs_manager.set_scene_change_callback(broadcast_scene_change)
            scene = obs_manager.get_current_scene()
            if scene:
                broadcast_scene_change(scene)

# Kick off update check in background (non-blocking)
threading.Thread(target=check_for_update, daemon=True, name="update-check").start()

if __name__ == "__main__":
    # The Werkzeug reloader/debugger re-launches sys.executable -- which, in a
    # frozen onefile build, double-starts the whole exe. Keep them dev-only.
    app.run(debug=not FROZEN, host="0.0.0.0", threaded=True, use_reloader=not FROZEN)