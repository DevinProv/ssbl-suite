from flask import Flask, render_template
from flask_sock import Sock
from database import db
from routes import players_bp, events_bp, sets_bp, characters_bp, obs_bp, settings_bp
from routes.overlay import overlay_bp, _connected_overlays, broadcast_state, broadcast_scene_change
from config import get_active_theme, get_obs_config
import json

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///ssbl.db"
db.init_app(app)
sock = Sock(app)

app.register_blueprint(players_bp, url_prefix="/api")
app.register_blueprint(events_bp, url_prefix="/api")
app.register_blueprint(sets_bp, url_prefix="/api")
app.register_blueprint(characters_bp, url_prefix="/api")
app.register_blueprint(obs_bp, url_prefix="/api")
app.register_blueprint(settings_bp, url_prefix="/api")
app.register_blueprint(overlay_bp)

@app.context_processor
def inject_theme():
    return {"theme": get_active_theme()}

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

@sock.route("/ws/overlay")
def overlay_ws(ws):
    from routes.overlay import _current_state, load_config
    _connected_overlays.add(ws)
    try:
        ws.send(json.dumps({"type": "config", "data": load_config()}))
        ws.send(json.dumps({"type": "state", "data": _current_state}))
    except Exception:
        pass
    try:
        while True:
            msg = ws.receive(timeout=30)
            if msg is None:
                break
    except Exception:
        pass
    finally:
        _connected_overlays.discard(ws)

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
            # Wire scene change callback
            obs_manager.set_scene_change_callback(broadcast_scene_change)
            # Set initial active scene
            scene = obs_manager.get_current_scene()
            if scene:
                broadcast_scene_change(scene)

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0")