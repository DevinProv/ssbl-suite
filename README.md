# SSBL Suite

A local tournament-overlay control panel for Super Smash Bros. streams. It runs
as a small web app on your machine, talks to **OBS** over the OBS WebSocket, and
drives a browser-source overlay (player names, characters, scores, scene-aware
layouts). It also imports brackets from **Challonge** and **start.gg**.

The app is a local web server — you run it, then control everything from your
browser at **http://localhost:5000**.

---

## Quick start

### Option A — download the build (recommended)

1. Grab the latest release from the [Releases page](https://github.com/DevinProv/ssbl-suite/releases):
   - **Windows:** `app.exe`
   - **Linux:** `app` (plus `app.sha256`)
2. Put it in its own folder — the app writes its database, configs, and the
   `images/` art folder **next to the executable**.
3. Run it:
   - **Windows:** double-click `app.exe`.
   - **Linux:** `chmod +x app && ./app`
4. Open **http://localhost:5000** in your browser.

> On first launch a **Setup Wizard** appears to download character art and
> connect OBS — see [First-run setup](#first-run-setup) below.

### Option B — run from source

```bash
pip install -r requirements.txt
python app.py
```

Then open **http://localhost:5000**.

---

## First-run setup

The dashboard shows a setup wizard the first time it can't find character art or
an OBS connection:

1. **Character Art** — if no art is found, click **Download art pack** and it's
   fetched and unpacked automatically into your `images/` folder. (If you
   already have art, you can skip this step.)
2. **Connect OBS** — enter your OBS WebSocket details. The **?** button next to
   the password field explains how to enable WebSocket and find the password.

You can re-open any of this later from the **Settings** page. The wizard only
nags on first run.

---

## Connecting OBS WebSocket

The app reads your active OBS scene and pushes overlay updates over the OBS
WebSocket. You only need to set this up once.

### 1. Enable the WebSocket server in OBS

WebSocket support is **built into OBS 28 and newer**. (On older versions, install
the [obs-websocket](https://github.com/obsproject/obs-websocket/releases) plugin
first.)

1. In OBS, open **Tools → WebSocket Server Settings**.
2. Check **Enable WebSocket server**.
3. Leave **Server Port** at `4455` unless you've changed it.
4. Keep **Enable Authentication** ticked, then click **Show Connect Info**
   (or **Generate Password**) to reveal the password.
5. Copy the password, click **Apply**, then **OK**.

### 2. Connect from the app

Open **Settings → OBS WebSocket** (or use the setup wizard) and enter:

| Field | Value |
|-------|-------|
| **Host** | `localhost` (if OBS is on the same PC) or the other PC's IP |
| **Port** | `4455` (or whatever you set in OBS) |
| **Password** | the password from step 4 above |

Click **Connect**. The status dot turns green when it's working. Click
**Save Config** so it reconnects automatically next launch.

> Running OBS on a **second PC**? Use that PC's LAN IP for **Host**, and make
> sure its firewall allows inbound connections on the WebSocket port.

---

## Adding the overlay as a Browser Source in OBS

The overlay is a web page the app serves; you add it to OBS as a Browser Source.

1. In OBS, select the scene you want the overlay on.
2. Under **Sources**, click **+ → Browser**.
3. Name it (e.g. `SSBL Overlay`) and click **OK**.
4. Set the properties:
   - **URL:** `http://localhost:5000/overlay/display`
   - **Width:** `1920`  **Height:** `1080` (match your canvas resolution)
   - Tick **Shutdown source when not visible** and
     **Refresh browser when scene becomes active** if you want it to reset
     cleanly between scenes.
5. Click **OK**. The overlay connects automatically and updates live as you
   change players/scores in the app.

To design what the overlay shows per scene, use the **Overlay** page in the app
(**http://localhost:5000/overlay**) — it's a drag-and-drop editor, and layouts
are saved per OBS scene.

> If the Browser Source is blank: confirm the app is running, that the URL opens
> in a normal browser tab, and that the width/height match your OBS canvas.

---

## Where your data lives

Everything writable is stored **next to the executable** (or the project folder
when running from source):

- `ssbl.db` — players, events, sets, games (SQLite)
- `images/` — character art (one folder per character, color images inside)
- `static/*.json` — OBS, start.gg, sync, and overlay configs

These survive restarts and auto-updates, so keep the executable in a stable
folder.

---

## Updating

On **Windows**, the app checks GitHub Releases on startup. When a newer version
is found it downloads and verifies it in the background, then shows an
**Update available** prompt. You can apply it two ways:

- **Update & Restart** — applies it immediately (the app closes and reopens).
- **Later** — the update is applied automatically the next time you open the app.

> **Upgrading from v1.0.4 or earlier?** Those builds can download an update but
> don't apply it on a normal restart. Open **Settings → App Updates** and click
> **Restart & Update** once to move up to v1.0.5+. From then on, restarts apply
> staged updates automatically.

On **Linux**, re-download the latest `app` from the Releases page.

Releases are published automatically when a `v*` tag is pushed, and every build
ships a SHA-256 checksum the updater verifies before installing.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Page won't load | Make sure the app is running and you're using `http://localhost:5000`. |
| OBS won't connect | Re-check **Tools → WebSocket Server Settings**: server enabled, correct port, and the exact password. |
| Overlay is blank in OBS | Verify the Browser Source URL and that width/height match your canvas. |
| No characters show up | Run the setup wizard's art download, or drop character folders into `images/` and hit **Refresh** on the dashboard. |
| Port 5000 is in use | Another app is using it — close that app (a configurable port is on the roadmap). |
