# logic/obsmanager.py
import obsws_python as obs
import os
import threading

class OBSManager:
    def __init__(self):
        self._client = None
        self._event_client = None
        self._scene_change_callback = None

    def connect(self, host, port, password):
        try:
            self._client = obs.ReqClient(host=host, port=port, password=password, timeout=3)
            print(f"[OBS] Connected to {host}:{port}")
            self._start_event_client(host, port, password)
            return True
        except Exception as e:
            print(f"[OBS] Connection failed: {e}")
            self._client = None
            return False

    def _start_event_client(self, host, port, password):
        def on_current_program_scene_changed(data):
            print(f"[OBS] Scene changed to: {data.scene_name}")
            if self._scene_change_callback:
                self._scene_change_callback(data.scene_name)

        try:
            from obsws_python import subs
            self._event_client = obs.EventClient(
                host=host, port=port, password=password,
                subs=subs.Subs.SCENES
            )
            self._event_client.callback.register(on_current_program_scene_changed)
            print("[OBS] EventClient connected - listening for scene changes")
        except Exception as e:
            print(f"[OBS] EventClient failed: {e}")
            self._event_client = None
        

    def set_scene_change_callback(self, callback):
        self._scene_change_callback = callback

    def disconnect(self):
        if self._event_client:
            try:
                self._event_client.disconnect()
            except Exception:
                pass
            self._event_client = None
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
        except Exception as e:
            self._client = None
            return False

    def get_current_scene(self):
        if not self._client:
            return None
        try:
            return self._client.get_current_program_scene().current_program_scene_name
        except Exception as e:
            print(f"[OBS] Get scene error: {e}")
            return None

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

    def get_canvas_screenshot(self):
        if not self._client:
            return None
        try:
            w, h = self.get_canvas_resolution()
            scene_name = self._client.get_current_program_scene().current_program_scene_name
            response = self._client.get_source_screenshot(
                name=scene_name,
                img_format="jpg",
                width=w,
                height=h,
                quality=60
            )
            return response.image_data
        except Exception as e:
            print(f"[OBS] Screenshot error: {e}")
            return None

    def get_canvas_resolution(self):
        if not self._client:
            return 1920, 1080
        try:
            response = self._client.get_video_settings()
            return response.base_width, response.base_height
        except Exception as e:
            print(f"[OBS] Resolution error: {e}")
            return 1920, 1080

obs_manager = OBSManager()