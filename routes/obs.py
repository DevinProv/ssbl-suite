from flask import Blueprint, jsonify, request
from logic.obsmanager import obs_manager
from config import get_obs_config, save_obs_config

obs_bp = Blueprint("obs", __name__)

@obs_bp.route("/obs/connect", methods=["POST"])
def connect():
    data = request.get_json()
    host = data.get("host", "localhost")
    port = data.get("port", 4455)
    password = data.get("password", "")
    success = obs_manager.connect(host, port, password)
    return jsonify({"connected": success})

@obs_bp.route("/obs/disconnect", methods=["POST"])
def disconnect():
    obs_manager.disconnect()
    return jsonify({"connected": False})

@obs_bp.route("/obs/status", methods=["GET"])
def status():
    return jsonify({"connected": obs_manager.is_connected()})

@obs_bp.route("/obs/sources", methods=["GET"])
def get_sources():
    scenes, inputs = obs_manager.get_scenes_and_inputs()
    return jsonify({"scenes": scenes, "inputs": inputs})

@obs_bp.route("/obs/source", methods=["POST"])
def set_source():
    data = request.get_json()
    source_name = data.get("source_name")
    input_kind = data.get("input_kind")
    new_value = data.get("value")
    if not source_name or not input_kind or new_value is None:
        return jsonify({"error": "Missing source_name, input_kind, or value"}), 400
    success = obs_manager.set_source_value(source_name, input_kind, new_value)
    return jsonify({"ok": success})

@obs_bp.route("/obs/timestamp", methods=["GET"])
def get_timestamp():
    if not obs_manager.is_connected():
        return jsonify({"error": "Not connected to OBS"}), 400
    timecode = obs_manager.get_timecode()
    if timecode is None:
        return jsonify({"error": "No active recording or stream"}), 400
    return jsonify({"duration": timecode})

@obs_bp.route("/obs/last-recording", methods=["GET"])
def latest_recording():
    if not obs_manager.is_connected():
        return jsonify({"error": "Not connected to OBS"}), 400
    filename = obs_manager.get_latest_recording()
    if filename is None:
        return jsonify({"error": "No recording found"}), 400
    return jsonify({"filename": filename})

@obs_bp.route("/obs/screenshot", methods=["GET"])
def get_screenshot():
    if not obs_manager.is_connected():
        return jsonify({"error": "Not connected to OBS"}), 400
    screenshot = obs_manager.get_canvas_screenshot()
    if screenshot is None:
        return jsonify({"error": "Failed to capture screenshot"}), 500
    return jsonify({"image": screenshot})

@obs_bp.route("/obs/resolution", methods=["GET"])
def get_resolution():
    if not obs_manager.is_connected():
        return jsonify({"error": "Not connected"}), 400
    w, h = obs_manager.get_canvas_resolution()
    return jsonify({"width": w, "height": h})

@obs_bp.route("/obs/config", methods=["GET"])
def obs_config_get():
    return jsonify(get_obs_config())

@obs_bp.route("/obs/config", methods=["POST"])
def obs_config_save():
    data = request.get_json()
    save_obs_config(data)
    return jsonify({"ok": True})
                                
@obs_bp.route("/obs/current-scene", methods=["GET"])
def current_scene():
    if not obs_manager.is_connected():
        return jsonify({"error": "Not connected"}), 400
    scene = obs_manager.get_current_scene()
    if scene is None:
        return jsonify({"error": "Could not get scene"}), 500
    return jsonify({"scene": scene})