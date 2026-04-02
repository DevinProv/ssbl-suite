import os
import json
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

CHARACTER_ASSETS_ROOT = os.environ.get("CHARACTER_ASSETS_ROOT", 
                                       os.path.expanduser("~/projects/assets/ssbl-app/images"))
THEMES_PATH = os.path.join(BASE_DIR, "static", "themes", "theme.json")

def get_active_theme():
    with open(THEMES_PATH, "r") as f:
        data = json.load(f)
    active = data.get("active", "midnight_arena")
    return data["themes"].get(active, list(data["themes"].values())[0])