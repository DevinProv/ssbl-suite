import os
from config import CHARACTER_ASSETS_ROOT
class CharacterManager:
    def __init__(self):
        self.data = {}
        self.char_dir = ""
        self.refresh()
    
    def refresh(self):
        self.data = {}
        self.char_dir = os.path.abspath(CHARACTER_ASSETS_ROOT)
        print(f"Loading character data from: {self.char_dir}")
        if not os.path.exists(self.char_dir):
            print(f"Character directory '{self.char_dir}' does not exist.")
            return
        try:
            for char_name in os.listdir(self.char_dir):
                char_path = os.path.join(self.char_dir, char_name)
                if os.path.isdir(char_path):
                    colors = []
                    for file in os.listdir(char_path):
                        if file.lower().endswith((".png", ".jpg", ".jpeg", ".gif")):
                            colors.append(file)
                    colors.sort()
                    if colors:
                        self.data[char_name] = colors
        except Exception as e:
            print(f"Error loading character data: {e}")

    def get_character_names(self):
        return sorted(list(self.data.keys()))
    
    def get_colors(self, character_name):
        return self.data.get(character_name, [])
    
    def get_asset_path(self, character_name, color_filename):
        if not character_name or not color_filename:
            return os.path.join(self.char_dir, "placeholder.png")
        path = os.path.join(self.char_dir, character_name, color_filename)
        if os.path.exists(path):
            return path
        return os.path.join(self.char_dir, "placeholder.png")

char_manager = CharacterManager()
