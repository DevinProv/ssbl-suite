# logic/obsmanager.py
import obsws_python as obs
import os

class OBSManager:
    def __init__(self):
        self._client = None

    def connect(self, host, port, password):
        try:
            self._client = obs.ReqClient(host=host, port=port, password=password, timeout=3)
            print(f"[OBS] Connected to {host}:{port}")
            return True
        except Exception as e:
            print(f"[OBS] Connection failed: {e}")
            self._client = None
            return False

    def disconnect(self):
        if self._client:
            try:
                self._client.base_client.ws.disconnect()
            except Exception:
                pass
            self._client = None
            print("[OBS] Disconnected")

    def is_connected(self):
        if not self._client:
            return False
        try:
            self._client.get_version()
            return True
        except Exception:
            self._client = None
            return False

    def get_timecode(self):
        if not self._client:
            return None
        try:
            record = self._client.get_record_status()
            if record.output_active:
                return record.output_duration
            stream = self._client.get_stream_status()
            if stream.output_active:
                return stream.output_duration
        except Exception as e:
            print(f"[OBS] Timecode error: {e}")
        return None

    def get_scenes_and_inputs(self):
        if not self._client:
            return [], []
        try:
            scenes = [s["sceneName"] for s in self._client.get_scene_list().scenes]
            raw_inputs = self._client.get_input_list().inputs
            inputs = [
                {
                    "name": i["inputName"],
                    "kind": i["inputKind"],
                    "emoji": self.get_kind_emoji(i["inputKind"])
                }
                for i in raw_inputs
            ]
            return sorted(scenes), sorted(inputs, key=lambda x: x["name"])
        except Exception as e:
            print(f"[OBS] Refresh error: {e}")
            return [], []

    def get_kind_emoji(self, kind):
        mapping = {
            "text":    "📝",
            "image":   "📷",
            "browser": "🌐",
            "ffmpeg":  "🎥",
            "capture": "📡",
        }
        for key in mapping:
            if key in kind:
                return mapping[key]
        return "❓"

    def set_source_value(self, source_name, input_kind, new_value):
        if not self._client:
            return False
        kind_map = {
            "text":    {"text": str(new_value)},
            "image":   {"file": str(new_value)},
            "browser": {"url": str(new_value)},
            "ffmpeg":  {"local_file": str(new_value)},
        }
        settings = next((v for k, v in kind_map.items() if k in input_kind), None)
        if not settings:
            print(f"[OBS] Unsupported kind: {input_kind}")
            return False
        try:
            self._client.set_input_settings(
                name=source_name, settings=settings, overlay=True
            )
            return True
        except Exception as e:
            print(f"[OBS] Set source error: {e}")
            return False
    def get_latest_recording(self):
        if not self._client:
            return None
        try:
            directory = self._client.get_record_directory().record_directory
            files = sorted(
                [f for f in os.listdir(directory) if f.endswith((".mkv", ".mp4", ".flv"))],
                key=lambda f: os.path.getmtime(os.path.join(directory, f)),
                reverse=True
            )
            return os.path.join(directory, files[0]) if files else None
        except Exception as e:
            print(f"[OBS] Error getting latest recording: {e}")
            return None
        
    def get_canvas_screenshot(self, width=1920, height=1080):
        if not self._client:
            return None
        try:
            response = self._client.get_source_screenshot(
                source_name=self._client.get_current_program_scene().current_program_scene_name,
                img_format="jpg",
                img_width=width,
                img_height=height,
                img_quality=70
            )
            return response.image_data  # returns base64 data URI already formatted
        except Exception as e:
            print(f"[OBS] Screenshot error: {e}")
            return None
        
    def get_canvas_resolution(self):
        if not self._client:
            return 1920, 1080  # sensible default
        try:
            response = self._client.get_video_settings()
            return response.base_width, response.base_height
        except Exception as e:
            print(f"[OBS] Resolution error: {e}")
            return 1920, 1080
obs_manager = OBSManager()