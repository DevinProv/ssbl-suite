import os
import json
from paths import user_data_path, FROZEN

# Character art lives outside the repo, so it can't be bundled into the exe.
# Frozen builds look for an "images" folder next to the exe (drop art there);
# source runs keep the original dev default. Either is overridable via env.
_default_assets = user_data_path("images") if FROZEN \
    else os.path.expanduser("~/projects/assets/ssbl-app/images")
CHARACTER_ASSETS_ROOT = os.environ.get("CHARACTER_ASSETS_ROOT", _default_assets)

# Writable config -- persisted next to the exe when frozen (see paths.py).
THEMES_PATH = user_data_path("static", "themes", "theme.json")
OBS_CONFIG_PATH = user_data_path("static", "obs_config.json")

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