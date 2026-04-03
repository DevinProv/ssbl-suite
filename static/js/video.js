let vods = [];
let selectedSets = new Set(); // set_ids selected for bulk action
let statusPollers = {}; // set_id -> interval

// =====================
// Init
// =====================
async function init() {
    await Promise.all([loadConfig(), checkYTAuth(), loadVods()]);
    setupConfigSave();
    setupBulkActions();
    setupYTAuth();
}

// =====================
// Config
// =====================
async function loadConfig() {
    const cfg = await fetch("/api/video/config").then(r => r.json());
    document.getElementById("title-template").value = cfg.title_template || "";
    document.getElementById("output-subdir").value = cfg.output_subdir || "cutsets";
}

function setupConfigSave() {
    document.getElementById("save-config-btn").addEventListener("click", async () => {
        const template = document.getElementById("title-template").value.trim();
        const subdir = document.getElementById("output-subdir").value.trim();
        await fetch("/api/video/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title_template: template, output_subdir: subdir })
        });
        // Re-render with new titles
        await loadVods();
        showToast("Config saved", "success");
    });
}

// =====================
// YouTube Auth
// =====================
async function checkYTAuth() {
    const res = await fetch("/api/video/auth/status").then(r => r.json());
    const dot = document.getElementById("yt-dot");
    const label = document.getElementById("yt-label");
    const authBtn = document.getElementById("yt-auth-btn");
    const revokeBtn = document.getElementById("yt-revoke-btn");
    const credsHint = document.getElementById("yt-creds-hint");

    if (res.error === "no_credentials") {
        dot.className = "status-dot";
        label.textContent = "YouTube — no credentials file";
        credsHint.style.display = "inline";
        return;
    }

    credsHint.style.display = "none";
    if (res.authenticated) {
        dot.className = "status-dot connected";
        label.textContent = "YouTube Connected";
        revokeBtn.style.display = "block";
        authBtn.style.display = "none";
    } else {
        dot.className = "status-dot";
        label.textContent = "YouTube Not Connected";
        authBtn.style.display = "block";
        revokeBtn.style.display = "none";
    }
}

function setupYTAuth() {
    document.getElementById("yt-auth-btn").addEventListener("click", () => {
        window.location.href = "/api/video/auth/youtube";
    });
    document.getElementById("yt-revoke-btn").addEventListener("click", async () => {
        await fetch("/api/video/auth/revoke", { method: "POST" });
        await checkYTAuth();
    });
}

// =====================
// Load VODs
// =====================
async function loadVods() {
    vods = await fetch("/api/video/vods").then(r => r.json());
    renderVodList();
}

function renderVodList() {
    const container = document.getElementById("vod-list");

    if (vods.length === 0) {
        container.innerHTML = `
            <div class="video-empty">
                <div class="video-empty-icon">🎬</div>
                <p>No VODs found.<br>Start and end sets while recording in OBS to log timestamps.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = vods.map(vod => renderVodGroup(vod)).join("");

    // Wire up interactions
    vods.forEach(vod => {
        vod.sets.forEach(s => wireSetRow(s, vod));
    });
}

function renderVodGroup(vod) {
    const allCut = vod.sets.every(s => s.clip && (s.clip.status === "cut" || s.clip.status === "uploaded"));
    const allUploaded = vod.sets.every(s => s.clip && s.clip.status === "uploaded");

    return `
        <div class="vod-group" id="vod-group-${vod.filename.replace(/[^a-z0-9]/gi, '_')}">
            <div class="vod-group-header">
                <span class="vod-filename" title="${vod.filename}">📹 ${vod.basename}</span>
                <span class="vod-set-count">${vod.sets.length} set${vod.sets.length !== 1 ? "s" : ""}</span>
                <div class="vod-group-actions">
                    <button class="btn-ghost" onclick="cutAllInVod('${escapeAttr(vod.filename)}')">✂ Cut All</button>
                    <button class="btn-ghost" onclick="uploadAllInVod('${escapeAttr(vod.filename)}')">↑ Upload All</button>
                </div>
            </div>
            ${vod.sets.map(s => renderSetRow(s)).join("")}
        </div>
    `;
}

function renderSetRow(s) {
    const status = s.clip ? s.clip.status : "none";
    const badgeLabels = {
        none: "Not Cut", cutting: "Cutting...", cut: "Ready",
        uploading: "Uploading...", uploaded: "Uploaded", failed: "Failed"
    };
    const ytLink = s.clip?.youtubeUrl
        ? `<a href="${s.clip.youtubeUrl}" target="_blank" style="color:var(--primary);font-size:11px">▶ YouTube</a>`
        : "";

    return `
        <div class="set-row" id="set-row-${s.id}" data-set-id="${s.id}" data-vod="${escapeAttr(s.vodFilename)}">
            <input type="checkbox" class="set-row-check" data-set-id="${s.id}">
            <div class="set-row-info">
                <div class="set-row-title">
                    <input type="text" class="title-input" data-set-id="${s.id}" value="${escapeAttr(s.title)}">
                </div>
                <div class="set-row-meta">
                    <span>${s.eventTitle}</span>
                    <span>·</span>
                    <span>${s.round || "Unknown Round"}</span>
                    ${s.winner ? `<span>·</span><span>🏆 ${s.winner}</span>` : ""}
                    ${ytLink ? `<span>·</span>${ytLink}` : ""}
                </div>
            </div>
            <div class="set-row-timestamps">
                <div>${s.startDisplay} → ${s.endDisplay}</div>
                <div style="color:var(--primary)">${s.durationDisplay}</div>
            </div>
            <span class="clip-badge ${status}">${badgeLabels[status] || status}</span>
            <div class="set-row-actions">
                <button class="btn-ghost" style="padding:4px 10px;font-size:11px"
                    onclick="cutSingle(${s.id})"
                    ${status === "cutting" || status === "uploading" ? "disabled" : ""}>
                    ✂
                </button>
                <button class="btn-ghost" style="padding:4px 10px;font-size:11px"
                    onclick="uploadSingle(${s.id})"
                    ${status !== "cut" ? "disabled" : ""}>
                    ↑
                </button>
            </div>
        </div>
    `;
}

function wireSetRow(s, vod) {
    const row = document.getElementById(`set-row-${s.id}`);
    if (!row) return;

    // Checkbox for bulk select
    const check = row.querySelector(".set-row-check");
    check.addEventListener("change", () => {
        if (check.checked) selectedSets.add(s.id);
        else selectedSets.delete(s.id);
        updateBulkBar();
    });

    // Start polling if in progress
    if (s.clip && (s.clip.status === "cutting" || s.clip.status === "uploading")) {
        startPolling(s.id);
    }
}

// =====================
// Cut & Upload
// =====================
function getTitle(setId) {
    const input = document.querySelector(`.title-input[data-set-id="${setId}"]`);
    return input ? input.value.trim() : `clip_${setId}`;
}

async function cutSingle(setId) {
    const title = getTitle(setId);
    await fetch(`/api/video/cut/${setId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
    });
    updateRowStatus(setId, "cutting");
    startPolling(setId);
}

async function uploadSingle(setId) {
    await fetch(`/api/video/upload/${setId}`, { method: "POST" });
    updateRowStatus(setId, "uploading");
    startPolling(setId);
}

async function cutAllInVod(filename) {
    const vod = vods.find(v => v.filename === filename);
    if (!vod) return;
    const set_ids = vod.sets.map(s => s.id);
    const titles = {};
    set_ids.forEach(id => { titles[id] = getTitle(id); });
    await fetch("/api/video/cut/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ set_ids, titles })
    });
    set_ids.forEach(id => { updateRowStatus(id, "cutting"); startPolling(id); });
    showToast(`Cutting ${set_ids.length} clips...`);
}

async function uploadAllInVod(filename) {
    const vod = vods.find(v => v.filename === filename);
    if (!vod) return;
    const set_ids = vod.sets.filter(s => s.clip?.status === "cut").map(s => s.id);
    if (set_ids.length === 0) { showToast("No clips ready to upload", "error"); return; }
    await fetch("/api/video/upload/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ set_ids })
    });
    set_ids.forEach(id => { updateRowStatus(id, "uploading"); startPolling(id); });
    showToast(`Uploading ${set_ids.length} clips...`);
}

// =====================
// Bulk Actions
// =====================
function updateBulkBar() {
    const bar = document.getElementById("bulk-bar");
    const count = document.getElementById("bulk-count");
    if (selectedSets.size > 0) {
        bar.classList.add("visible");
        count.textContent = `${selectedSets.size} selected`;
    } else {
        bar.classList.remove("visible");
    }
}

function setupBulkActions() {
    document.getElementById("bulk-cut-btn").addEventListener("click", async () => {
        const set_ids = [...selectedSets];
        const titles = {};
        set_ids.forEach(id => { titles[id] = getTitle(id); });
        await fetch("/api/video/cut/bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ set_ids, titles })
        });
        set_ids.forEach(id => { updateRowStatus(id, "cutting"); startPolling(id); });
        showToast(`Cutting ${set_ids.length} clips...`);
        clearSelection();
    });

    document.getElementById("bulk-upload-btn").addEventListener("click", async () => {
        const set_ids = [...selectedSets];
        await fetch("/api/video/upload/bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ set_ids })
        });
        set_ids.forEach(id => { updateRowStatus(id, "uploading"); startPolling(id); });
        showToast(`Uploading ${set_ids.length} clips...`);
        clearSelection();
    });

    document.getElementById("bulk-clear-btn").addEventListener("click", clearSelection);
}

function clearSelection() {
    selectedSets.clear();
    document.querySelectorAll(".set-row-check").forEach(c => c.checked = false);
    updateBulkBar();
}

// =====================
// Status Polling
// =====================
function startPolling(setId) {
    if (statusPollers[setId]) return;
    statusPollers[setId] = setInterval(async () => {
        const res = await fetch(`/api/video/status/${setId}`).then(r => r.json());
        updateRowStatus(setId, res.status, res);
        if (res.status !== "cutting" && res.status !== "uploading") {
            clearInterval(statusPollers[setId]);
            delete statusPollers[setId];
            if (res.status === "uploaded") {
                showToast("Upload complete!", "success");
            } else if (res.status === "cut") {
                showToast("Clip ready", "success");
            } else if (res.status === "failed") {
                showToast("Operation failed", "error");
            }
        }
    }, 2000);
}

function updateRowStatus(setId, status, data) {
    const badge = document.querySelector(`#set-row-${setId} .clip-badge`);
    const cutBtn = document.querySelector(`#set-row-${setId} .set-row-actions button:first-child`);
    const uploadBtn = document.querySelector(`#set-row-${setId} .set-row-actions button:last-child`);
    const meta = document.querySelector(`#set-row-${setId} .set-row-meta`);

    const badgeLabels = {
        none: "Not Cut", cutting: "Cutting...", cut: "Ready",
        uploading: "Uploading...", uploaded: "Uploaded", failed: "Failed"
    };

    if (badge) {
        badge.className = `clip-badge ${status}`;
        badge.textContent = badgeLabels[status] || status;
    }
    if (cutBtn) cutBtn.disabled = status === "cutting" || status === "uploading";
    if (uploadBtn) uploadBtn.disabled = status !== "cut";

    // Add YouTube link to meta if uploaded
    if (status === "uploaded" && data?.youtubeUrl && meta) {
        const existing = meta.querySelector(".yt-link");
        if (!existing) {
            meta.insertAdjacentHTML("beforeend",
                `<span>·</span><a class="yt-link" href="${data.youtubeUrl}" target="_blank" style="color:var(--primary);font-size:11px">▶ YouTube</a>`
            );
        }
    }
}

// =====================
// Helpers
// =====================
function escapeAttr(str) {
    return (str || "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function showToast(msg, type = "") {
    let toast = document.getElementById("toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast";
        document.body.appendChild(toast);
        toast.style.cssText = `
            position:fixed;bottom:24px;right:24px;
            background:var(--surface-3);border:1px solid var(--outline);
            color:var(--on-surface);padding:10px 16px;border-radius:8px;
            font-size:12px;font-weight:500;opacity:0;transform:translateY(8px);
            transition:opacity 0.2s,transform 0.2s;pointer-events:none;z-index:9999;
        `;
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