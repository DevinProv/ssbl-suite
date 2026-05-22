// First-run setup wizard. Shows on the dashboard when character art is missing
// or OBS isn't configured yet, and remembers when the user finishes/skips.
(function () {
    const $ = (id) => document.getElementById(id);
    const overlay = $("wizard-overlay");
    if (!overlay) return;

    let pollTimer = null;
    let current = 1;

    // ---- step navigation ----
    function goStep(n) {
        current = n;
        document.querySelectorAll(".wizard-step").forEach(el => el.classList.remove("active"));
        $("wizard-step-" + n).classList.add("active");

        document.querySelectorAll(".wizard-steps .step").forEach(el => {
            const s = parseInt(el.dataset.step, 10);
            el.classList.toggle("active", s === n);
            el.classList.toggle("done", s < n);
        });

        $("wiz-back").style.display   = n > 1 ? "inline-flex" : "none";
        $("wiz-next").style.display   = n < 2 ? "inline-flex" : "none";
        $("wiz-finish").style.display = n >= 2 ? "inline-flex" : "none";
    }

    function openWizard()  { overlay.classList.add("open"); }
    function closeWizard() {
        overlay.classList.remove("open");
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    async function dismiss() {
        try { await fetch("/api/setup/dismiss", { method: "POST" }); } catch (e) {}
        closeWizard();
    }

    // ---- step 1: character art ----
    function showImagesPresent(count) {
        $("wiz-images-missing").style.display = "none";
        $("wiz-images-present").style.display = "block";
        $("wiz-images-present-text").textContent =
            `Character art is installed${count ? ` — ${count} characters loaded` : ""}.`;
    }

    function fmtMB(bytes) { return (bytes / 1048576).toFixed(1) + " MB"; }

    function renderProgress(p) {
        const bar   = $("wiz-progress").querySelector(".bar");
        const label = $("wiz-progress-label");
        if (p.state === "downloading") {
            if (p.total > 0) {
                const pct = Math.min(100, Math.round(p.downloaded / p.total * 100));
                bar.style.width = pct + "%";
                label.textContent = `Downloading… ${fmtMB(p.downloaded)} / ${fmtMB(p.total)} (${pct}%)`;
            } else {
                bar.style.width = "100%";
                label.textContent = `Downloading… ${fmtMB(p.downloaded)}`;
            }
        } else if (p.state === "extracting") {
            bar.style.width = "100%";
            label.textContent = "Extracting…";
        } else if (p.state === "done") {
            bar.style.width = "100%";
            label.textContent = `✓ Done — ${p.characters} characters installed.`;
            showImagesPresent(p.characters);
        } else if (p.state === "error") {
            label.textContent = "✕ " + (p.error || "Download failed.");
            $("wiz-download-btn").disabled = false;
            $("wiz-download-btn").textContent = "Retry download";
        }
    }

    async function startDownload() {
        const btn = $("wiz-download-btn");
        btn.disabled = true;
        btn.textContent = "Downloading…";
        $("wiz-progress").style.display = "block";

        const res = await fetch("/api/setup/download-images", { method: "POST" })
            .then(r => r.json()).catch(() => null);
        if (!res || (!res.started && res.state !== "downloading" && res.state !== "extracting")) {
            $("wiz-progress-label").textContent = "✕ Could not start download.";
            btn.disabled = false;
            btn.textContent = "Retry download";
            return;
        }

        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(async () => {
            const p = await fetch("/api/setup/download-progress").then(r => r.json()).catch(() => null);
            if (!p) return;
            renderProgress(p);
            if (p.state === "done" || p.state === "error") {
                clearInterval(pollTimer);
                pollTimer = null;
            }
        }, 700);
    }

    // ---- step 2: OBS ----
    function setObsStatus(connected, msg) {
        $("wiz-obs-dot").className = "wiz-dot" + (connected ? " connected" : (msg ? " error" : ""));
        $("wiz-obs-label").textContent = msg || (connected ? "Connected" : "Not connected");
    }

    async function connectObs() {
        const host = $("wiz-obs-host").value.trim() || "localhost";
        const port = parseInt($("wiz-obs-port").value, 10) || 4455;
        const password = $("wiz-obs-password").value;
        const btn = $("wiz-obs-connect");
        btn.disabled = true; btn.textContent = "Connecting…";
        setObsStatus(false, "Connecting…");

        // Save the config either way so it persists for next launch.
        await fetch("/api/obs/config", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ host, port, password }),
        }).catch(() => {});

        const res = await fetch("/api/obs/connect", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ host, port, password }),
        }).then(r => r.json()).catch(() => ({ connected: false }));

        btn.disabled = false; btn.textContent = "Connect";
        setObsStatus(res.connected, res.connected ? "Connected" : "Couldn't connect — check the help below");
    }

    // ---- wiring ----
    $("wizard-close").addEventListener("click", dismiss);
    $("wiz-skip").addEventListener("click", dismiss);
    $("wiz-back").addEventListener("click", () => goStep(current - 1));
    $("wiz-next").addEventListener("click", () => goStep(current + 1));
    $("wiz-finish").addEventListener("click", dismiss);
    $("wiz-download-btn").addEventListener("click", startDownload);
    $("wiz-skip-images").addEventListener("click", (e) => { e.preventDefault(); goStep(2); });
    $("wiz-obs-connect").addEventListener("click", connectObs);
    $("wiz-obs-help-btn").addEventListener("click", () => $("wiz-obs-help").classList.toggle("open"));

    // ---- boot ----
    (async function init() {
        let status;
        try { status = await fetch("/api/setup/status").then(r => r.json()); }
        catch (e) { return; }
        if (!status.needs_setup) return;

        $("wiz-images-dir").textContent = status.images_dir || "";
        if (status.images_present) showImagesPresent();

        // Prefill OBS fields from saved config.
        try {
            const cfg = await fetch("/api/obs/config").then(r => r.json());
            $("wiz-obs-host").value = cfg.host || "localhost";
            $("wiz-obs-port").value = cfg.port || 4455;
            $("wiz-obs-password").value = cfg.password || "";
        } catch (e) {}
        setObsStatus(status.obs_connected, status.obs_connected ? "Connected" : "Not connected");

        goStep(status.images_present ? 2 : 1);
        openWizard();
    })();
})();
