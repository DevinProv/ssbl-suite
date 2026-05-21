async function init() {
    const [obsStatus, obsCfg, startggCfg] = await Promise.all([
        fetch("/api/obs/status").then(r => r.json()),
        fetch("/api/obs/config").then(r => r.json()),
        fetch("/api/startgg/config").then(r => r.json()),
    ]);

    document.getElementById("obs-host").value = obsCfg.host || "localhost";
    document.getElementById("obs-port").value = obsCfg.port || 4455;
    document.getElementById("obs-password").value = obsCfg.password || "";
    setObsStatus(obsStatus.connected);

    // start.gg
    if (startggCfg.has_key) {
        document.getElementById("startgg-api-key").value = startggCfg.api_key;
        document.getElementById("startgg-status").style.display = "flex";
    }
}

function setObsStatus(connected) {
    const dot = document.getElementById("obs-dot");
    const label = document.getElementById("obs-status-label");
    dot.className = "status-dot" + (connected ? " connected" : "");
    label.textContent = connected ? "Connected" : "Disconnected";
}

// OBS
document.getElementById("obs-connect-btn").addEventListener("click", async () => {
    const host = document.getElementById("obs-host").value;
    const port = parseInt(document.getElementById("obs-port").value);
    const password = document.getElementById("obs-password").value;
    const res = await fetch("/api/obs/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, port, password })
    }).then(r => r.json());
    setObsStatus(res.connected);
});

document.getElementById("obs-disconnect-btn").addEventListener("click", async () => {
    await fetch("/api/obs/disconnect", { method: "POST" });
    setObsStatus(false);
});

document.getElementById("obs-save-btn").addEventListener("click", async () => {
    const host = document.getElementById("obs-host").value;
    const port = parseInt(document.getElementById("obs-port").value);
    const password = document.getElementById("obs-password").value;
    await fetch("/api/obs/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, port, password })
    });
    showToast("OBS config saved");
});

// start.gg
document.getElementById("startgg-toggle-btn").addEventListener("click", () => {
    const input = document.getElementById("startgg-api-key");
    input.type = input.type === "password" ? "text" : "password";
});

document.getElementById("startgg-save-btn").addEventListener("click", async () => {
    const key = document.getElementById("startgg-api-key").value.trim();
    if (!key) { showToast("Paste your API key first", "error"); return; }
    await fetch("/api/startgg/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key })
    });
    document.getElementById("startgg-status").style.display = "flex";
    showToast("start.gg API key saved", "success");
});

document.getElementById("startgg-clear-btn").addEventListener("click", async () => {
    await fetch("/api/startgg/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: "" })
    });
    document.getElementById("startgg-api-key").value = "";
    document.getElementById("startgg-status").style.display = "none";
    showToast("API key cleared");
});

// Theme
document.getElementById("theme-save-btn").addEventListener("click", async () => {
    const theme = document.getElementById("theme-select").value;
    await fetch("/api/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: theme })
    });
    location.reload();
});

function showToast(msg, type = "") {
    let toast = document.getElementById("toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast";
        document.body.appendChild(toast);
        toast.style.cssText = `position:fixed;bottom:24px;right:24px;background:var(--surface-3);border:1px solid var(--outline);color:var(--on-surface);padding:10px 16px;border-radius:8px;font-size:12px;font-weight:500;opacity:0;transform:translateY(8px);transition:opacity 0.2s,transform 0.2s;pointer-events:none;z-index:9999;`;
    }
    toast.textContent = msg;
    toast.style.borderColor = type === "success" ? "var(--success)" : type === "error" ? "var(--danger)" : "var(--outline)";
    toast.style.color = type === "success" ? "var(--success)" : type === "error" ? "var(--danger)" : "var(--on-surface)";
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = "0"; toast.style.transform = "translateY(8px)"; }, 3000);
}
// =====================
// Data Sync
// =====================
async function initSync() {
    const res = await fetch("/api/sync/status").then(r => r.json());
    const cfg = await fetch("/api/sync/config").then(r => r.json());

    document.getElementById("sync-repo").value = cfg.repo || "";
    document.getElementById("sync-branch").value = cfg.branch || "main";
    document.getElementById("sync-token").value = cfg.github_token || "";
    document.getElementById("sync-auto").checked = cfg.auto_sync || false;

    if (res.last_export) {
        const d = new Date(res.last_export);
        document.getElementById("sync-status").style.display = "flex";
        document.getElementById("sync-status-label").textContent =
            `Last synced: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    }
    if (res.configured) {
        document.getElementById("sync-status").style.display = "flex";
    }
}

document.getElementById("sync-token-toggle").addEventListener("click", () => {
    const input = document.getElementById("sync-token");
    input.type = input.type === "password" ? "text" : "password";
});

document.getElementById("sync-save-btn").addEventListener("click", async () => {
    const repo = document.getElementById("sync-repo").value.trim();
    const branch = document.getElementById("sync-branch").value.trim() || "main";
    const token = document.getElementById("sync-token").value.trim();
    const auto_sync = document.getElementById("sync-auto").checked;

    await fetch("/api/sync/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ github_repo: repo, github_branch: branch, github_token: token, auto_sync })
    });
    showToast("Sync config saved", "success");
});

document.getElementById("sync-now-btn").addEventListener("click", async () => {
    const btn = document.getElementById("sync-now-btn");
    btn.textContent = "Syncing...";
    btn.disabled = true;

    const res = await fetch("/api/sync/push", { method: "POST" }).then(r => r.json());

    btn.textContent = "↑ Sync Now";
    btn.disabled = false;

    if (res.ok) {
        const d = new Date(res.exportedAt);
        document.getElementById("sync-status").style.display = "flex";
        document.getElementById("sync-status-label").textContent =
            `Last synced: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
        showToast(res.message, "success");
    } else {
        showToast(res.error || "Sync failed", "error");
    }
});

initSync();
// ── Update status ──────────────────────────────
async function initUpdateStatus() {
    try {
        const res = await fetch("/api/update/status").then(r => r.json());
        document.getElementById("current-version").textContent = res.current_version || "unknown";
 
        const dot   = document.getElementById("update-dot");
        const label = document.getElementById("update-label");
        const acts  = document.getElementById("update-actions");
 
        if (res.update_available) {
            dot.className   = "status-dot connected";   // green
            label.textContent = `Update available: v${res.new_version}`;
            acts.style.display = "flex";
        } else {
            dot.className   = "status-dot";
            label.textContent = "Up to date";
        }
    } catch(e) {
        document.getElementById("update-label").textContent = "Could not check for updates";
    }
}
 
document.getElementById("apply-update-btn")?.addEventListener("click", async () => {
    if (!confirm("The app will close and restart to apply the update. Continue?")) return;
    const res = await fetch("/api/update/apply", { method: "POST" }).then(r => r.json()).catch(() => null);
    if (res?.error) showToast(res.error, "error");
});
 
// ── GitHub import ──────────────────────────────
let _importData = null;
 
document.getElementById("import-preview-btn").addEventListener("click", async () => {
    const repo   = document.getElementById("import-repo").value.trim();
    const branch = document.getElementById("import-branch").value.trim() || "main";
    const btn    = document.getElementById("import-preview-btn");
 
    btn.textContent = "Fetching...";
    btn.disabled = true;
    _importData = null;
    document.getElementById("import-execute-btn").style.display = "none";
 
    const res = await fetch("/api/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, branch }),
    }).then(r => r.json());
 
    btn.textContent = "Preview";
    btn.disabled = false;
 
    if (!res.ok) {
        showToast(res.error || "Preview failed", "error");
        return;
    }
 
    _importData = res.data;
 
    const box = document.getElementById("import-preview-box");
    const s   = res.summary;
    const exp = res.meta?.exportedAt
        ? new Date(res.meta.exportedAt).toLocaleString()
        : "unknown";
 
    box.innerHTML = `
        <div style="margin-bottom:6px;font-weight:600;color:var(--on-surface)">
            ${res.repo} @ ${res.branch}
        </div>
        <div style="color:var(--on-surface-dim)">Exported: ${exp}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:8px">
            <span>👤 ${s.players} players</span>
            <span>📅 ${s.events} events</span>
            <span>🎮 ${s.sets} sets</span>
            <span>🕹 ${s.games} games</span>
        </div>
    `;
    box.style.display = "block";
    document.getElementById("import-execute-btn").style.display = "block";
});
 
document.getElementById("import-execute-btn").addEventListener("click", async () => {
    if (!_importData) { showToast("Preview first", "error"); return; }
    if (!confirm("This will overwrite local records that match IDs in the import. Continue?")) return;
 
    const btn = document.getElementById("import-execute-btn");
    btn.textContent = "Importing...";
    btn.disabled = true;
 
    const res = await fetch("/api/import/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: _importData }),
    }).then(r => r.json());
 
    btn.textContent = "Import Data";
    btn.disabled = false;
 
    if (!res.ok) {
        showToast(res.error || "Import failed", "error");
        return;
    }
 
    const i = res.imported;
    showToast(
        `Imported: ${i.players} players, ${i.events} events, ${i.sets} sets, ${i.games} games`,
        "success"
    );
    _importData = null;
    document.getElementById("import-execute-btn").style.display = "none";
});
 
initUpdateStatus();
init();