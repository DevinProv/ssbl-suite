import os
import json
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

CHARACTER_ASSETS_ROOT = os.environ.get("CHARACTER_ASSETS_ROOT", 
                                       os.path.expanduser("~/projects/assets/ssbl-app/images"))
THEMES_PATH = os.path.join(BASE_DIR, "static", "themes", "theme.json")
OBS_CONFIG_PATH = os.path.join(BASE_DIR, "static", "obs_config.json")

def get_active_theme():
    with open(THEMES_PATH, "r") as f:
        data = json.load(f)
    active = data.get("active", "midnight_arena")
    return data["themes"].get(active, list(data["themes"].values())[0])

def get_obs_config():
    if os.path.exists(OBS_CONFIG_PATH):
        with open(OBS_CONFIG_PATH, "r") as f:
            return json.load(f)
    return {"host": "localhost", "port": 4455, "password": ""}

def save_obs_config(data):
    with open(OBS_CONFIG_PATH, "w") as f:
        json.dump(data, f, indent=2)