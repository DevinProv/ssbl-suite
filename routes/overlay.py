from flask import Blueprint, jsonify, request, render_template
import json
import os

overlay_bp = Blueprint("overlay", __name__)

_connected_overlays = set()
_current_state = {
    "player1": {"name": "Player 1", "char": "", "color": "", "score": 0},
    "player2": {"name": "Player 2", "char": "", "color": "", "score": 0},
    "round": "",
    "event": "",
    "active_scene": ""
}

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "overlay_config.json")

DEFAULT_ELEMENTS = {
    "p1_name": {
        "label": "P1 Name", "type": "text", "visible": True,
        "x": 50, "y": 420,
        "font": "Rajdhani", "fontSize": 36, "fontColor": "#f0f0f2",
        "shadow": True, "shadowColor": "#000000",
        "background": False, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
        "opacity": 1.0
    },
    "p2_name": {
        "label": "P2 Name", "type": "text", "visible": True,
        "x": 1400, "y": 420,
        "font": "Rajdhani", "fontSize": 36, "fontColor": "#f0f0f2",
        "shadow": True, "shadowColor": "#000000",
        "background": False, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
        "opacity": 1.0
    },
    "p1_score": {
        "label": "P1 Score", "type": "text", "visible": True,
        "x": 820, "y": 80,
        "font": "Rajdhani", "fontSize": 48, "fontColor": "#f0f0f2",
        "shadow": True, "shadowColor": "#000000",
        "background": False, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
        "opacity": 1.0
    },
    "p2_score": {
        "label": "P2 Score", "type": "text", "visible": True,
        "x": 920, "y": 80,
        "font": "Rajdhani", "fontSize": 48, "fontColor": "#f0f0f2",
        "shadow": True, "shadowColor": "#000000",
        "background": False, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
        "opacity": 1.0
    },
    "round_name": {
        "label": "Round", "type": "text", "visible": True,
        "x": 760, "y": 40,
        "font": "Rajdhani", "fontSize": 28, "fontColor": "#f0f0f2",
        "shadow": True, "shadowColor": "#000000",
        "background": False, "bgColor": "#000000", "bgOpacity": 0.5, "borderRadius": 4,
        "opacity": 1.0
    },
    "event_name": {
        "label": "Event", "type": "text", "visible": True,
        "x": 660, "y": 10,
        "font": "Rajdhani", "fontSize": 22, "fontColor": "#f0f0f2",
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

def load_config():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r") as f:
            data = json.load(f)
        # Migrate old flat config to per-scene format
        if "elements" in data and "scenes" not in data:
            scene_name = data.get("active_scene", "Default")
            if not scene_name:
                scene_name = "Default"
            migrated = {
                "resolution": data.get("resolution", {"width": 1920, "height": 1080}),
                "active_scene": scene_name,
                "scenes": {
                    scene_name: {"elements": data["elements"]}
                }
            }
            save_config(migrated)
            return migrated
        return data
    return DEFAULT_CONFIG.copy()

def save_config(config):
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)

def get_scene_elements(config, scene_name):
    """Get elements for a scene, creating default if not exists."""
    if scene_name not in config.get("scenes", {}):
        config.setdefault("scenes", {})[scene_name] = {
            "elements": DEFAULT_ELEMENTS.copy()
        }
    return config["scenes"][scene_name]["elements"]

def broadcast_state(state):
    global _current_state
    _current_state = state
    dead = set()
    for ws in _connected_overlays:
        try:
            ws.send(json.dumps({"type": "state", "data": state}))
        except Exception:
            dead.add(ws)
    _connected_overlays.difference_update(dead)

def broadcast_config(config):
    dead = set()
    for ws in _connected_overlays:
        try:
            ws.send(json.dumps({"type": "config", "data": config}))
        except Exception:
            dead.add(ws)
    _connected_overlays.difference_update(dead)

def broadcast_scene_change(scene_name):
    """Push scene change to all overlay displays."""
    global _current_state
    _current_state["active_scene"] = scene_name
    config = load_config()
    config["active_scene"] = scene_name
    save_config(config)
    dead = set()
    for ws in _connected_overlays:
        try:
            ws.send(json.dumps({
                "type": "scene_change",
                "scene": scene_name,
                "data": config
            }))
        except Exception:
            dead.add(ws)
    _connected_overlays.difference_update(dead)

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
    """Save elements for a specific scene."""
    data = request.get_json()
    config = load_config()
    config.setdefault("scenes", {})[scene_name] = {"elements": data["elements"]}
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
        config["scenes"][active]["elements"] = DEFAULT_ELEMENTS.copy()
        save_config(config)
        broadcast_config(config)
        return jsonify(config)
    return jsonify({"error": "No active scene"}), 400