import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

CHARACTER_ASSETS_ROOT = os.environ.get("CHARACTER_ASSETS_ROOT", 
                                       os.path.expanduser("~/projects/assets/ssbl-app/images"))

