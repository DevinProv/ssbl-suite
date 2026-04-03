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

init();