from flask import Blueprint, jsonify, request, render_template
import json
import os
import copy
import queue
import threading

overlay_bp = Blueprint("overlay", __name__)

_connected_overlays = set()
_overlays_lock = threading.Lock()   # guards _connected_overlays
_broadcast_queue = queue.Queue()    # all WS sends go through here

_current_state = {
    "player1": {"name": "Player 1", "char": "", "color": "", "score": 0},
    "player2": {"name": "Player 2", "char": "", "color": "", "score": 0},
    "round": "",
    "event": "",
    "active_scene": ""
}

from paths import user_data_path
CONFIG_PATH = user_data_path("static", "overlay_config.json")

# Text elements carry an "align" (left | center | right). Centered/right
# elements anchor on their x so the top row stays centered as text length
# changes (handled by the display + editor via a CSS transform).
DEFAULT_ELEMENTS = {
    "event_name": {
        "label": "Event", "type": "text", "visible": True,
        "x": 960, "y": 12, "align": "center",
        "font": "Rajdhani", "fontSize": 22, "fontColor": "#f0f0f2",
        "shadow": True, "shadowColor": "#000000",
        "background": False, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
        "opacity": 1.0
    },
    "round_name": {
        "label": "Round", "type": "text", "visible": True,
        "x": 960, "y": 44, "align": "center",
        "font": "Rajdhani", "fontSize": 28, "fontColor": "#f0f0f2",
        "shadow": True, "shadowColor": "#000000",
        "background": False, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
        "opacity": 1.0
    },
    "p1_score": {
        "label": "P1 Score", "type": "text", "visible": True,
        "x": 926, "y": 84, "align": "right",
        "font": "Rajdhani", "fontSize": 48, "fontColor": "#f0f0f2",
        "shadow": True, "shadowColor": "#000000",
        "background": False, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
        "opacity": 1.0
    },
    "p2_score": {
        "label": "P2 Score", "type": "text", "visible": True,
        "x": 994, "y": 84, "align": "left",
        "font": "Rajdhani", "fontSize": 48, "fontColor": "#f0f0f2",
        "shadow": True, "shadowColor": "#000000",
        "background": False, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
        "opacity": 1.0
    },
    "score_combined": {
        "label": "Score (Combined)", "type": "text", "visible": False,
        "x": 960, "y": 84, "align": "center",
        "font": "Rajdhani", "fontSize": 48, "fontColor": "#f0f0f2",
        "shadow": True, "shadowColor": "#000000",
        "background": False, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
        "opacity": 1.0
    },
    "p1_name": {
        "label": "P1 Name", "type": "text", "visible": True,
        "x": 40, "y": 420, "align": "left",
        "font": "Rajdhani", "fontSize": 36, "fontColor": "#f0f0f2",
        "shadow": True, "shadowColor": "#000000",
        "background": False, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
        "opacity": 1.0
    },
    "p2_name": {
        "label": "P2 Name", "type": "text", "visible": True,
        "x": 1880, "y": 420, "align": "right",
        "font": "Rajdhani", "fontSize": 36, "fontColor": "#f0f0f2",
        "shadow": True, "shadowColor": "#000000",
        "background": False, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
        "opacity": 1.0
    },
    "p1_portrait": {
        "label": "P1 Portrait", "type": "image", "visible": True,
        "x": 30, "y": 460,
        "width": 200, "height": 200,
        "opacity": 1.0
    },
    "p2_portrait": {
        "label": "P2 Portrait", "type": "image", "visible": True,
        "x": 1690, "y": 460,
        "width": 200, "height": 200,
        "opacity": 1.0
    }
}

DEFAULT_CONFIG = {
    "resolution": {"width": 1920, "height": 1080},
    "active_scene": "",
    "scenes": {}
}

def default_elements():
    """A fresh, independent copy of the default element set."""
    return copy.deepcopy(DEFAULT_ELEMENTS)

def _ensure_keys(elements):
    """Backfill any default elements missing from a saved scene.

    Lets older configs pick up new elements (e.g. the combined score) without
    overwriting the user's existing positions/styles.
    """
    changed = False
    for key, default in DEFAULT_ELEMENTS.items():
        if key not in elements:
            elements[key] = copy.deepcopy(default)
            changed = True
    return changed

def load_config():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r") as f:
            data = json.load(f)
        dirty = False
        # Migrate old flat config to per-scene format
        if "elements" in data and "scenes" not in data:
            scene_name = data.get("active_scene", "Default") or "Default"
            data = {
                "resolution": data.get("resolution", {"width": 1920, "height": 1080}),
                "active_scene": scene_name,
                "scenes": {
                    scene_name: {"elements": data["elements"]}
                }
            }
            dirty = True
        # Backfill newly-added elements into every saved scene.
        for scene in data.get("scenes", {}).values():
            if _ensure_keys(scene.setdefault("elements", {})):
                dirty = True
        if dirty:
            save_config(data)
        return data
    return copy.deepcopy(DEFAULT_CONFIG)

def save_config(config):
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)

def get_scene_elements(config, scene_name):
    if scene_name not in config.get("scenes", {}):
        config.setdefault("scenes", {})[scene_name] = {
            "elements": default_elements()
        }
    return config["scenes"][scene_name]["elements"]


# =====================
# Thread-safe broadcast worker
# =====================
def _broadcast_worker():
    """
    Runs in a dedicated daemon thread.  All WebSocket sends go through the
    _broadcast_queue so that OBS callback threads (or any other non-WS thread)
    never touch flask-sock sockets directly.
    """
    while True:
        message = _broadcast_queue.get()        # blocks until work arrives
        _do_broadcast(message)
        _broadcast_queue.task_done()

def _do_broadcast(message: str):
    """Send *message* to every connected overlay; prune dead sockets."""
    dead = set()
    with _overlays_lock:
        snapshot = set(_connected_overlays)

    for ws in snapshot:
        try:
            ws.send(message)
        except Exception:
            dead.add(ws)

    if dead:
        with _overlays_lock:
            _connected_overlays.difference_update(dead)

def _enqueue(message: str):
    """Thread-safe: any thread can call this."""
    _broadcast_queue.put(message)

# Start the worker once at import time.
_worker_thread = threading.Thread(target=_broadcast_worker, daemon=True, name="overlay-broadcast")
_worker_thread.start()


# =====================
# Public broadcast helpers (called from routes & OBS callback)
# =====================
def broadcast_state(state):
    global _current_state
    _current_state = state
    _enqueue(json.dumps({"type": "state", "data": state}))

def broadcast_config(config):
    _enqueue(json.dumps({"type": "config", "data": config}))

def broadcast_scene_change(scene_name: str):
    """
    Called from the OBS EventClient thread when the scene changes.
    Safe to call from any thread.
    """
    global _current_state
    _current_state["active_scene"] = scene_name

    config = load_config()
    config["active_scene"] = scene_name

    # Ensure the scene has a default element set so the editor never sees an
    # empty canvas on first switch.
    if scene_name and scene_name not in config.get("scenes", {}):
        config.setdefault("scenes", {})[scene_name] = {
            "elements": default_elements()
        }

    save_config(config)

    _enqueue(json.dumps({
        "type": "scene_change",
        "scene": scene_name,
        "data": config,
    }))


# =====================
# Routes
# =====================
@overlay_bp.route("/overlay")
def overlay_editor():
    return render_template("overlay_editor.html")

@overlay_bp.route("/overlay/display")
def overlay_display():
    return render_template("overlay_display.html")

@overlay_bp.route("/api/overlay/config", methods=["GET"])
def get_config():
    return jsonify(load_config())

@overlay_bp.route("/api/overlay/config", methods=["POST"])
def set_config():
    config = request.get_json()
    save_config(config)
    broadcast_config(config)
    return jsonify({"ok": True})

@overlay_bp.route("/api/overlay/scene/<scene_name>", methods=["POST"])
def save_scene(scene_name):
    data = request.get_json()
    config = load_config()
    config.setdefault("scenes", {})[scene_name] = {"elements": data["elements"]}
    # Persist the canvas resolution so the display shares the editor's
    # coordinate space (synced from OBS when connected).
    res = data.get("resolution")
    if isinstance(res, dict) and res.get("width") and res.get("height"):
        config["resolution"] = {"width": res["width"], "height": res["height"]}
    save_config(config)
    broadcast_config(config)
    return jsonify({"ok": True})

@overlay_bp.route("/api/overlay/state", methods=["GET"])
def get_state():
    return jsonify(_current_state)

@overlay_bp.route("/api/overlay/state", methods=["POST"])
def set_state():
    state = request.get_json()
    broadcast_state(state)
    return jsonify({"ok": True})

@overlay_bp.route("/api/overlay/config/reset", methods=["POST"])
def reset_config():
    config = load_config()
    active = config.get("active_scene", "")
    if active and active in config.get("scenes", {}):
        config["scenes"][active]["elements"] = default_elements()
        save_config(config)
        broadcast_config(config)
        return jsonify(config)
    return jsonify({"error": "No active scene"}), 400