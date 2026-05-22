from flask import Blueprint, jsonify, request, redirect, session
from database import db
from models import MatchSet, Game, Event, Player, ClipExport
import os
import json
import subprocess
import threading

video_bp = Blueprint("video", __name__)

from paths import user_data_path
VIDEO_CONFIG_PATH = user_data_path("static", "video_config.json")
YT_CREDENTIALS_PATH = user_data_path("static", "youtube_credentials.json")
YT_TOKEN_PATH = user_data_path("static", "youtube_token.json")

DEFAULT_VIDEO_CONFIG = {
    "title_template": "[Event] - [Round] - [P1] vs [P2]",
    "output_subdir": "cutsets",
    "yt_redirect_uri": "http://localhost:5000/api/video/auth/callback",
}

def load_video_config():
    if os.path.exists(VIDEO_CONFIG_PATH):
        with open(VIDEO_CONFIG_PATH, "r") as f:
            return json.load(f)
    return DEFAULT_VIDEO_CONFIG.copy()

def save_video_config(cfg):
    with open(VIDEO_CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)

def ms_to_ffmpeg(ms):
    if ms is None:
        return None
    ms = float(ms)
    h = int(ms // 3600000)
    m = int((ms % 3600000) // 60000)
    s = (ms % 60000) / 1000
    return f"{h:02d}:{m:02d}:{s:06.3f}"

def ms_to_display(ms):
    if ms is None:
        return "--:--"
    ms = float(ms)
    h = int(ms // 3600000)
    m = int((ms % 3600000) // 60000)
    s = int((ms % 60000) / 1000)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"

def build_title(template, event_title, round_name, p1_name, p2_name):
    return (template
        .replace("[Event]", event_title or "")
        .replace("[Round]", round_name or "")
        .replace("[P1]", p1_name or "Player 1")
        .replace("[P2]", p2_name or "Player 2"))

def get_output_path(vod_path, set_id, title, output_subdir):
    vod_dir = os.path.dirname(vod_path)
    out_dir = os.path.join(vod_dir, output_subdir)
    os.makedirs(out_dir, exist_ok=True)
    safe_title = "".join(c if c.isalnum() or c in " -_" else "_" for c in title).strip()[:100]
    ext = os.path.splitext(vod_path)[1] or ".mp4"
    return os.path.join(out_dir, f"{set_id}_{safe_title}{ext}")

def serialize_set_for_video(s, event_map, player_map, cfg):
    event = event_map.get(s.eventID)
    p1 = player_map.get(s.player1ID)
    p2 = player_map.get(s.player2ID)
    winner = player_map.get(s.winnerID)
    title = build_title(
        cfg["title_template"],
        event.eventTitle if event else "",
        s.bracketRound or "",
        p1.name if p1 else "Player 1",
        p2.name if p2 else "Player 2"
    )
    clip = ClipExport.query.filter_by(setID=s.id).first()
    duration_ms = None
    if s.vodTimestampStart is not None and s.vodTimestampEnd is not None:
        duration_ms = float(s.vodTimestampEnd) - float(s.vodTimestampStart)
    return {
        "id": s.id,
        "eventID": s.eventID,
        "eventTitle": event.eventTitle if event else "Unknown",
        "round": s.bracketRound,
        "player1": p1.name if p1 else "Unknown",
        "player2": p2.name if p2 else "Unknown",
        "winner": winner.name if winner else None,
        "vodFilename": s.vodFilename,
        "vodTimestampStart": s.vodTimestampStart,
        "vodTimestampEnd": s.vodTimestampEnd,
        "startDisplay": ms_to_display(s.vodTimestampStart),
        "endDisplay": ms_to_display(s.vodTimestampEnd),
        "durationDisplay": ms_to_display(duration_ms),
        "title": title,
        "clip": {
            "id": clip.id,
            "status": clip.status,
            "outputPath": clip.output_path,
            "youtubeUrl": clip.youtube_url,
            "youtubeId": clip.youtube_id,
            "title": clip.title,
        } if clip else None
    }

# =====================
# VOD List
# =====================
@video_bp.route("/video/vods", methods=["GET"])
def get_vods():
    cfg = load_video_config()
    sets = MatchSet.query.filter(
        MatchSet.vodFilename.isnot(None),
        MatchSet.vodTimestampStart.isnot(None),
        MatchSet.vodTimestampEnd.isnot(None)
    ).all()
    if not sets:
        return jsonify([])
    event_ids = {s.eventID for s in sets}
    player_ids = {s.player1ID for s in sets} | {s.player2ID for s in sets} | {s.winnerID for s in sets if s.winnerID}
    event_map = {e.id: e for e in Event.query.filter(Event.id.in_(event_ids)).all()}
    player_map = {p.id: p for p in Player.query.filter(Player.id.in_(player_ids)).all()}
    vod_groups = {}
    for s in sets:
        fn = s.vodFilename
        if fn not in vod_groups:
            vod_groups[fn] = []
        vod_groups[fn].append(serialize_set_for_video(s, event_map, player_map, cfg))
    for fn in vod_groups:
        vod_groups[fn].sort(key=lambda x: x["vodTimestampStart"] or 0)
    sorted_vods = sorted(
        [{"filename": fn, "basename": os.path.basename(fn), "sets": sets_list} for fn, sets_list in vod_groups.items()],
        key=lambda v: max(s["id"] for s in v["sets"]),
        reverse=True
    )
    return jsonify(sorted_vods)

# =====================
# Config
# =====================
@video_bp.route("/video/config", methods=["GET"])
def get_video_config():
    return jsonify(load_video_config())

@video_bp.route("/video/config", methods=["POST"])
def set_video_config():
    data = request.get_json()
    cfg = load_video_config()
    if "title_template" in data:
        cfg["title_template"] = data["title_template"]
    if "output_subdir" in data:
        cfg["output_subdir"] = data["output_subdir"]
    if "yt_redirect_uri" in data:
        cfg["yt_redirect_uri"] = data["yt_redirect_uri"]
    save_video_config(cfg)
    return jsonify({"ok": True})

# =====================
# Clip Status
# =====================
@video_bp.route("/video/status/<int:set_id>", methods=["GET"])
def clip_status(set_id):
    clip = ClipExport.query.filter_by(setID=set_id).first()
    if not clip:
        return jsonify({"status": "none"})
    return jsonify({
        "status": clip.status,
        "outputPath": clip.output_path,
        "youtubeUrl": clip.youtube_url,
        "youtubeId": clip.youtube_id,
        "title": clip.title,
    })

# =====================
# FFmpeg Cutting
# =====================
def _cut_clip(app, set_id, title, output_path):
    with app.app_context():
        clip = ClipExport.query.filter_by(setID=set_id).first()
        match_set = MatchSet.query.get(set_id)
        if not clip or not match_set:
            return
        start = ms_to_ffmpeg(match_set.vodTimestampStart)
        duration_ms = float(match_set.vodTimestampEnd) - float(match_set.vodTimestampStart)
        duration = ms_to_ffmpeg(duration_ms)
        if not start or not duration:
            clip.status = "failed"
            db.session.commit()
            return
        cmd = ["ffmpeg", "-y", "-ss", start, "-i", match_set.vodFilename, "-t", duration, "-c", "copy", output_path]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if result.returncode == 0:
                clip.status = "cut"
                clip.output_path = output_path
                clip.title = title
            else:
                clip.status = "failed"
                print(f"[FFmpeg] Error for set {set_id}: {result.stderr[-500:]}")
        except Exception as e:
            clip.status = "failed"
            print(f"[FFmpeg] Exception for set {set_id}: {e}")
        db.session.commit()

@video_bp.route("/video/cut/<int:set_id>", methods=["POST"])
def cut_set(set_id):
    from app import app as flask_app
    match_set = MatchSet.query.get(set_id)
    if not match_set or not match_set.vodFilename:
        return jsonify({"error": "No VOD for this set"}), 400
    if match_set.vodTimestampStart is None or match_set.vodTimestampEnd is None:
        return jsonify({"error": "Missing timestamps"}), 400
    cfg = load_video_config()
    data = request.get_json() or {}
    title = data.get("title", f"clip_{set_id}")
    output_path = get_output_path(match_set.vodFilename, set_id, title, cfg["output_subdir"])
    clip = ClipExport.query.filter_by(setID=set_id).first()
    if not clip:
        clip = ClipExport(setID=set_id, status="cutting", title=title, output_path=output_path)
        db.session.add(clip)
    else:
        clip.status = "cutting"
        clip.title = title
        clip.output_path = output_path
    db.session.commit()
    threading.Thread(target=_cut_clip, args=(flask_app, set_id, title, output_path), daemon=True).start()
    return jsonify({"ok": True, "status": "cutting"})

@video_bp.route("/video/cut/bulk", methods=["POST"])
def cut_bulk():
    from app import app as flask_app
    data = request.get_json()
    set_ids = data.get("set_ids", [])
    titles = data.get("titles", {})
    cfg = load_video_config()
    jobs = []
    for set_id in set_ids:
        match_set = MatchSet.query.get(set_id)
        if not match_set or not match_set.vodFilename:
            continue
        title = titles.get(str(set_id), f"clip_{set_id}")
        output_path = get_output_path(match_set.vodFilename, set_id, title, cfg["output_subdir"])
        clip = ClipExport.query.filter_by(setID=set_id).first()
        if not clip:
            clip = ClipExport(setID=set_id, status="cutting", title=title, output_path=output_path)
            db.session.add(clip)
        else:
            clip.status = "cutting"
            clip.title = title
            clip.output_path = output_path
        jobs.append((set_id, title, output_path))
    db.session.commit()

    def run_all():
        for sid, t, op in jobs:
            _cut_clip(flask_app, sid, t, op)

    threading.Thread(target=run_all, daemon=True).start()
    return jsonify({"ok": True, "queued": len(jobs)})

# =====================
# YouTube Auth
# =====================
YT_SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]

@video_bp.route("/video/auth/status", methods=["GET"])
def yt_auth_status():
    if not os.path.exists(YT_CREDENTIALS_PATH):
        return jsonify({"authenticated": False, "error": "no_credentials"})
    if not os.path.exists(YT_TOKEN_PATH):
        return jsonify({"authenticated": False})
    return jsonify({"authenticated": True})

# Store flow state between auth start and callback
_yt_flow_store = {}

@video_bp.route("/video/auth/youtube")
def yt_auth_start():
    if not os.path.exists(YT_CREDENTIALS_PATH):
        return jsonify({"error": "youtube_credentials.json not found"}), 400

    from google_auth_oauthlib.flow import Flow
    cfg = load_video_config()
    redirect_uri = cfg.get("yt_redirect_uri", "http://localhost:5000/api/video/auth/callback")

    flow = Flow.from_client_secrets_file(
        YT_CREDENTIALS_PATH,
        scopes=YT_SCOPES,
        redirect_uri=redirect_uri,
    )
    auth_url, state = flow.authorization_url(
        access_type="offline",
        prompt="consent",
    )

    # Store flow keyed by state so callback can retrieve it
    _yt_flow_store[state] = flow

    return jsonify({"ok": True, "auth_url": auth_url})

@video_bp.route("/video/auth/callback")
def yt_auth_callback():
    state = request.args.get("state")
    flow = _yt_flow_store.pop(state, None)
    if not flow:
        return "Auth session expired or invalid. Please try again.", 400

    callback_url = request.url
    if callback_url.startswith("https://"):
        callback_url = "http://" + callback_url[8:]

    try:
        flow.fetch_token(authorization_response=callback_url)
    except Exception as e:
        return f"Token exchange failed: {e}", 400

    creds = flow.credentials
    with open(YT_TOKEN_PATH, "w") as f:
        json.dump({
            "token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": creds.token_uri,
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "scopes": list(creds.scopes or YT_SCOPES)
        }, f, indent=2)

    print("[YouTube] Auth complete, token saved.")
    # Return a page that closes itself and tells the user to go back
    return """<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#1a1c1e;color:#f0f0f2">
        <h2>✅ YouTube Connected!</h2>
        <p>You can close this tab and return to the SSBL app.</p>
        <script>setTimeout(() => window.close(), 2000);</script>
    </body></html>"""

@video_bp.route("/video/auth/revoke", methods=["POST"])
def yt_auth_revoke():
    if os.path.exists(YT_TOKEN_PATH):
        os.remove(YT_TOKEN_PATH)
    return jsonify({"ok": True})

# =====================
# YouTube Upload
# =====================
def _upload_to_youtube(app, set_id):
    with app.app_context():
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload

        clip = ClipExport.query.filter_by(setID=set_id).first()
        if not clip or not os.path.exists(clip.output_path or ""):
            if clip:
                clip.status = "failed"
                db.session.commit()
            return

        clip.status = "uploading"
        db.session.commit()

        try:
            with open(YT_TOKEN_PATH) as f:
                td = json.load(f)
            creds = Credentials(
                token=td["token"], refresh_token=td["refresh_token"],
                token_uri=td["token_uri"], client_id=td["client_id"],
                client_secret=td["client_secret"], scopes=td["scopes"]
            )
            yt = build("youtube", "v3", credentials=creds)
            body = {
                "snippet": {"title": clip.title, "description": "", "categoryId": "20"},
                "status": {"privacyStatus": "public"}
            }
            media = MediaFileUpload(clip.output_path, mimetype="video/*", resumable=True)
            req = yt.videos().insert(part=",".join(body.keys()), body=body, media_body=media)
            response = None
            while response is None:
                _, response = req.next_chunk()
            clip.status = "uploaded"
            clip.youtube_id = response["id"]
            clip.youtube_url = f"https://www.youtube.com/watch?v={response['id']}"
            print(f"[YouTube] Uploaded set {set_id}: {clip.youtube_url}")
        except Exception as e:
            clip.status = "failed"
            print(f"[YouTube] Upload failed for set {set_id}: {e}")
        db.session.commit()

@video_bp.route("/video/upload/<int:set_id>", methods=["POST"])
def upload_set(set_id):
    from app import app as flask_app
    clip = ClipExport.query.filter_by(setID=set_id).first()
    if not clip:
        return jsonify({"error": "No clip — cut first"}), 400
    # Allow retry if clip was cut but upload previously failed and file still exists
    if clip.status not in ("cut", "failed"):
        return jsonify({"error": f"Not ready (status: {clip.status})"}), 400
    if clip.status == "failed" and not os.path.exists(clip.output_path or ""):
        return jsonify({"error": "Clip file missing — cut again first"}), 400
    clip.status = "uploading"
    db.session.commit()
    threading.Thread(target=_upload_to_youtube, args=(flask_app, set_id), daemon=True).start()
    return jsonify({"ok": True})

@video_bp.route("/video/upload/bulk", methods=["POST"])
def upload_bulk():
    from app import app as flask_app
    data = request.get_json()
    set_ids = data.get("set_ids", [])
    queued = []
    for sid in set_ids:
        clip = ClipExport.query.filter_by(setID=sid).first()
        if clip and clip.status in ("cut", "failed") and os.path.exists(clip.output_path or ""):
            clip.status = "uploading"
            queued.append(sid)
    db.session.commit()

    def run():
        for sid in queued:
            _upload_to_youtube(flask_app, sid)

    threading.Thread(target=run, daemon=True).start()
    return jsonify({"ok": True, "queued": len(queued)})