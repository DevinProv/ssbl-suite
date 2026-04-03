async function init() {
    const [obsStatus, obsCfg] = await Promise.all([
        fetch("/api/obs/status").then(r => r.json()),
        fetch("/api/obs/config").then(r => r.json())
    ]);

    document.getElementById("obs-host").value = obsCfg.host || "localhost";
    document.getElementById("obs-port").value = obsCfg.port || 4455;
    document.getElementById("obs-password").value = obsCfg.password || "";

    setStatus(obsStatus.connected);
}

function setStatus(connected) {
    const dot = document.getElementById("obs-dot");
    const label = document.getElementById("obs-status-label");
    dot.className = "status-dot" + (connected ? " connected" : "");
    label.textContent = connected ? "Connected" : "Disconnected";
}

document.getElementById("obs-connect-btn").addEventListener("click", async () => {
    const host = document.getElementById("obs-host").value;
    const port = parseInt(document.getElementById("obs-port").value);
    const password = document.getElementById("obs-password").value;
    const res = await fetch("/api/obs/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, port, password })
    }).then(r => r.json());
    setStatus(res.connected);
});

document.getElementById("obs-disconnect-btn").addEventListener("click", async () => {
    await fetch("/api/obs/disconnect", { method: "POST" });
    setStatus(false);
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
    alert("OBS config saved — will auto-connect on next startup.");
});

document.getElementById("theme-save-btn").addEventListener("click", async () => {
    const theme = document.getElementById("theme-select").value;
    await fetch("/api/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: theme })
    });
    location.reload();
});

init();