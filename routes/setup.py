"""First-run setup wizard backend.

Drives the dashboard wizard: reports what still needs configuring, downloads
and unpacks the bundled character-art archive into CHARACTER_ASSETS_ROOT, and
remembers when the user has finished/skipped so it only shows on first run.
"""
import os
import json
import shutil
import zipfile
import tarfile
import tempfile
import threading
import urllib.request

from flask import Blueprint, jsonify

from config import CHARACTER_ASSETS_ROOT, get_obs_config
from paths import user_data_path
from logic.charmanager import char_manager
from logic.obsmanager import obs_manager

setup_bp = Blueprint("setup", __name__)

# Public download of the default character-art pack.
IMAGES_URL = "https://dl.holyknife.net/api/public/dl/B1KPVBJ8?inline=true"

_STATE_PATH = user_data_path("setup_state.json")
_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".gif")

# Background download/extract progress (one job at a time).
_dl_lock = threading.Lock()
_dl = {
    "state": "idle",        # idle | downloading | extracting | done | error
    "downloaded": 0,
    "total": 0,
    "characters": 0,
    "error": None,
}


# =====================
# Persisted wizard state
# =====================
def _load_state():
    try:
        with open(_STATE_PATH, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_state(**updates):
    state = _load_state()
    state.update(updates)
    try:
        with open(_STATE_PATH, "w") as f:
            json.dump(state, f, indent=2)
    except Exception:
        pass
    return state


def _images_present():
    """True once at least one character folder with art has loaded."""
    char_manager.refresh()
    return len(char_manager.data) > 0


def _obs_configured():
    cfg = get_obs_config()
    return bool(cfg.get("host") and cfg.get("password"))


# =====================
# Download progress helpers
# =====================
def _dl_snapshot():
    with _dl_lock:
        return dict(_dl)


def _set_dl(**updates):
    with _dl_lock:
        _dl.update(updates)


# =====================
# Routes
# =====================
@setup_bp.route("/setup/status", methods=["GET"])
def setup_status():
    state = _load_state()
    images = _images_present()
    obs_cfg = _obs_configured()
    dismissed = bool(state.get("dismissed"))
    return jsonify({
        "images_present": images,
        "images_dir": os.path.abspath(CHARACTER_ASSETS_ROOT),
        "obs_configured": obs_cfg,
        "obs_connected": obs_manager.is_connected(),
        "dismissed": dismissed,
        # Show the wizard on first run until the user finishes or skips it.
        "needs_setup": (not dismissed) and (not images or not obs_cfg),
        "download": _dl_snapshot(),
    })


@setup_bp.route("/setup/download-images", methods=["POST"])
def download_images():
    with _dl_lock:
        if _dl["state"] in ("downloading", "extracting"):
            return jsonify({"started": False, "state": _dl["state"]})
        _dl.update(state="downloading", downloaded=0, total=0, error=None, characters=0)
    threading.Thread(target=_download_and_extract, daemon=True, name="img-download").start()
    return jsonify({"started": True})


@setup_bp.route("/setup/download-progress", methods=["GET"])
def download_progress():
    return jsonify(_dl_snapshot())


@setup_bp.route("/setup/dismiss", methods=["POST"])
def dismiss():
    _save_state(dismissed=True)
    return jsonify({"ok": True})


# =====================
# Download + extract worker
# =====================
def _download_and_extract():
    tmp_path = None
    try:
        req = urllib.request.Request(IMAGES_URL, headers={"User-Agent": "SSBL-App"})
        fd, tmp_path = tempfile.mkstemp(suffix=".archive")
        os.close(fd)

        # Streams over the verified SSL context configured in app.py.
        with urllib.request.urlopen(req, timeout=30) as r:
            _set_dl(total=int(r.headers.get("Content-Length") or 0))
            downloaded = 0
            with open(tmp_path, "wb") as out:
                for chunk in iter(lambda: r.read(131072), b""):
                    out.write(chunk)
                    downloaded += len(chunk)
                    _set_dl(downloaded=downloaded)

        _set_dl(state="extracting")
        _extract_archive(tmp_path, os.path.abspath(CHARACTER_ASSETS_ROOT))

        char_manager.refresh()
        _set_dl(state="done", characters=len(char_manager.data))
    except Exception as e:
        _set_dl(state="error", error=str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


def _dir_has_image_file(path):
    """True if `path` directly contains at least one image file."""
    try:
        return any(
            e.lower().endswith(_IMAGE_EXTS) and os.path.isfile(os.path.join(path, e))
            for e in os.listdir(path)
        )
    except OSError:
        return False


def _is_character_folder(path):
    """A leaf folder of color images for one character.

    It holds image files directly and has no image-bearing subfolders -- the
    latter would make it a *parent* of character folders, not a character.
    """
    try:
        has_img_subdir = any(
            os.path.isdir(os.path.join(path, e)) and _dir_has_image_file(os.path.join(path, e))
            for e in os.listdir(path)
        )
    except OSError:
        return False
    return _dir_has_image_file(path) and not has_img_subdir


def _find_character_root(root):
    """Find the dir whose immediate subfolders are the character folders.

    The art pack wraps everything in a top-level ``images/`` dir that *also*
    holds a loose ``placeholder.png`` -- so a naive "stop at the first folder
    containing an image" check mistakes that wrapper for a character folder and
    double-nests it (``images/images/<char>/``). Instead we search
    shallowest-first for the folder that actually *contains* character folders,
    no matter how deeply it's wrapped.
    """
    queue = [root]
    while queue:
        d = queue.pop(0)
        try:
            subdirs = [os.path.join(d, e) for e in os.listdir(d)
                       if os.path.isdir(os.path.join(d, e))]
        except OSError:
            continue
        if any(_is_character_folder(s) for s in subdirs):
            return d
        queue.extend(subdirs)
    return root  # nothing matched; copy the archive as-is


def _extract_archive(archive_path, dest_root):
    """Unpack a zip/tar into dest_root, flattening any wrapping folder(s)."""
    tmp = tempfile.mkdtemp(prefix="ssbl_imgs_")
    try:
        if zipfile.is_zipfile(archive_path):
            with zipfile.ZipFile(archive_path) as z:
                z.extractall(tmp)
        elif tarfile.is_tarfile(archive_path):
            with tarfile.open(archive_path) as t:
                t.extractall(tmp)
        else:
            raise ValueError("Downloaded file is not a .zip or .tar archive")

        src = _find_character_root(tmp)

        os.makedirs(dest_root, exist_ok=True)
        for name in os.listdir(src):
            s = os.path.join(src, name)
            d = os.path.join(dest_root, name)
            if os.path.isdir(s):
                shutil.copytree(s, d, dirs_exist_ok=True)
            else:
                shutil.copy2(s, d)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
