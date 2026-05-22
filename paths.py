"""Filesystem path resolution for both source and PyInstaller-frozen runs.

When packaged with ``pyinstaller --onefile``, the exe unpacks its bundled,
read-only resources into a temp directory exposed as ``sys._MEIPASS``. That
directory is recreated on every launch and wiped on exit, so anything written
there does not persist. We therefore split paths into two kinds:

* ``resource_path`` -- bundled, read-only assets: templates, css/js, default
  config seeds, the certifi CA bundle. Lives in ``sys._MEIPASS`` when frozen.
* ``user_data_path`` -- writable, persistent files: configs, OAuth tokens, the
  SQLite DB, exports, character art. Stored next to the exe so they survive
  restarts and auto-updates.

In source runs both resolve to the project directory, preserving dev behavior.
"""
import os
import sys

FROZEN = getattr(sys, "frozen", False)

_PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))


def resource_path(*parts):
    """Path to a bundled, read-only resource shipped inside the exe."""
    base = getattr(sys, "_MEIPASS", _PROJECT_DIR)
    return os.path.join(base, *parts)


def user_data_path(*parts):
    """Path to a writable file that must persist across restarts/updates.

    Next to the exe when frozen; the project directory in source runs.
    """
    base = os.path.dirname(sys.executable) if FROZEN else _PROJECT_DIR
    return os.path.join(base, *parts)


def seed_user_data():
    """Materialize bundled defaults that callers expect to already exist.

    Only ``static/themes/theme.json`` is read without a missing-file fallback,
    so it's the one file we must copy out next to the exe on first launch.
    Existing files are never overwritten, so user edits survive updates.
    """
    if not FROZEN:
        return
    import shutil

    os.makedirs(user_data_path("static"), exist_ok=True)
    for rel in (os.path.join("themes", "theme.json"),):
        dst = user_data_path("static", rel)
        if os.path.exists(dst):
            continue
        src = resource_path("static", rel)
        if os.path.exists(src):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
