let allEvents = [];
let allPlayers = [];
let selectedEvent = null;
let activeTab = "detail";
let pendingImport = null;
let previewResult = null; // full preview data from server

// =====================
// Init
// =====================
async function init() {
    await Promise.all([fetchEvents(), fetchPlayers()]);
    setupNewEvent();
    setupImportModal();
    setupResolutionModal();
}

async function fetchEvents() {
    allEvents = await fetch("/api/events").then(r => r.json());
    renderEventList();
}

async function fetchPlayers() {
    allPlayers = await fetch("/api/players").then(r => r.json());
}

// =====================
// Event List
// =====================
function renderEventList() {
    const list = document.getElementById("events-list");
    if (allEvents.length === 0) {
        list.innerHTML = `<div style="color:var(--on-surface-dim);font-size:12px;padding:16px;text-align:center">No events yet</div>`;
        return;
    }
    const sorted = [...allEvents].sort((a, b) => b.id - a.id);
    list.innerHTML = sorted.map(e => `
        <div class="event-list-item ${selectedEvent?.id === e.id ? "active" : ""}" data-id="${e.id}">
            <div class="event-list-title">${e.eventTitle}</div>
            <div class="event-list-meta">
                <span>${e.eventDate || "No date"}</span>
                <span>·</span>
                <span>${(e.rounds || []).length} rounds</span>
                ${e.bracketSlug ? `<span class="event-challonge-badge">${e.bracketSlug.includes("start.gg") || e.bracketSlug.includes("/") ? "start.gg" : "Challonge"}</span>` : ""}
            </div>
        </div>
    `).join("");

    list.querySelectorAll(".event-list-item").forEach(item => {
        item.addEventListener("click", () => {
            const ev = allEvents.find(e => e.id === parseInt(item.dataset.id));
            if (ev) selectEvent(ev);
        });
    });
}

function selectEvent(event) {
    selectedEvent = event;
    renderEventList();
    renderEventDetail(event);
}

// =====================
// Event Detail
// =====================
function renderEventDetail(event) {
    const right = document.getElementById("events-right");
    right.innerHTML = `
        <div class="events-tab-bar">
            <button class="events-tab ${activeTab === "detail" ? "active" : ""}" data-tab="detail">Details & Rounds</button>
            <button class="events-tab ${activeTab === "roundmap" ? "active" : ""}" data-tab="roundmap">Round Mapping</button>
        </div>

        <!-- Detail Tab -->
        <div class="tab-content ${activeTab === "detail" ? "active" : ""}" id="tab-detail">
            <div class="event-detail-card">
                <h3>Event Info</h3>
                <div class="event-field">
                    <label>Title</label>
                    <input type="text" id="ev-title" value="${escAttr(event.eventTitle)}">
                </div>
                <div class="event-field">
                    <label>Date</label>
                    <input type="date" id="ev-date" value="${escAttr(event.eventDate || "")}">
                </div>
                <div class="event-field">
                    <label>Bracket Link</label>
                    <input type="text" id="ev-bracket" value="${escAttr(event.bracketLink || "")}">
                </div>
                ${event.bracketSlug ? `
                <div class="event-field">
                    <label>Import Slug</label>
                    <input type="text" value="${escAttr(event.bracketSlug)}" readonly style="opacity:0.6;font-size:11px">
                </div>` : ""}
                <div style="display:flex;gap:8px">
                    <button class="btn-primary" id="save-event-btn">Save</button>
                    <button class="btn-danger" id="delete-event-btn">Delete Event</button>
                </div>
            </div>

            <div class="event-detail-card">
                <h3>Rounds</h3>
                <div class="rounds-editor" id="rounds-editor"></div>
                <div style="display:flex;gap:8px;margin-top:4px">
                    <input type="text" id="new-round-input" placeholder="Add round..." style="flex:1;background:var(--surface-2);border:1px solid var(--outline);border-radius:8px;color:var(--on-surface);padding:7px 12px;font-size:13px;outline:none">
                    <button class="btn-ghost" id="add-round-btn">Add</button>
                </div>
            </div>
        </div>

        <!-- Round Map Tab -->
        <div class="tab-content ${activeTab === "roundmap" ? "active" : ""}" id="tab-roundmap">
            <div class="event-detail-card">
                <h3>Round Name Translation</h3>
                <p style="font-size:12px;color:var(--on-surface-dim);margin-bottom:8px">
                    Map bracket round names to your template names. Used during all imports.
                </p>
                <div class="round-map-table" id="round-map-table"></div>
                <button class="btn-ghost" id="add-map-row-btn" style="margin-top:8px;align-self:flex-start">+ Add Row</button>
                <div style="display:flex;gap:8px;margin-top:8px">
                    <button class="btn-primary" id="save-round-map-btn">Save Mapping</button>
                </div>
            </div>
        </div>
    `;

    right.querySelectorAll(".events-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            activeTab = tab.dataset.tab;
            right.querySelectorAll(".events-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === activeTab));
            right.querySelectorAll(".tab-content").forEach(c => c.classList.toggle("active", c.id === `tab-${activeTab}`));
            if (activeTab === "roundmap") loadRoundMap();
        });
    });

    renderRoundsEditor(event.rounds || []);
    setupDetailActions(event);
    if (activeTab === "roundmap") loadRoundMap();
}

// =====================
// Rounds Editor
// =====================
let currentRounds = [];

function renderRoundsEditor(rounds) {
    currentRounds = [...rounds];
    const editor = document.getElementById("rounds-editor");
    if (!editor) return;
    editor.innerHTML = currentRounds.map((r, i) => `
        <div class="round-chip" data-index="${i}">
            <span>⠿</span>
            <span style="flex:1">${r}</span>
            <button class="round-chip-del" data-index="${i}">✕</button>
        </div>
    `).join("");
    editor.querySelectorAll(".round-chip-del").forEach(btn => {
        btn.addEventListener("click", () => {
            currentRounds.splice(parseInt(btn.dataset.index), 1);
            renderRoundsEditor(currentRounds);
        });
    });
}

// =====================
// Detail Actions
// =====================
function setupDetailActions(event) {
    const saveBtn = document.getElementById("save-event-btn");
    const deleteBtn = document.getElementById("delete-event-btn");
    const addRoundBtn = document.getElementById("add-round-btn");
    const newRoundInput = document.getElementById("new-round-input");
    if (!saveBtn) return;

    addRoundBtn?.addEventListener("click", () => {
        const val = newRoundInput.value.trim();
        if (!val) return;
        currentRounds.push(val);
        renderRoundsEditor(currentRounds);
        newRoundInput.value = "";
    });

    newRoundInput?.addEventListener("keydown", e => {
        if (e.key === "Enter") addRoundBtn?.click();
    });

    saveBtn.addEventListener("click", async () => {
        const title = document.getElementById("ev-title").value.trim();
        const date = document.getElementById("ev-date").value;
        const bracket = document.getElementById("ev-bracket").value.trim();
        if (!title) { showToast("Title required", "error"); return; }
        await fetch(`/api/events/${event.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ eventTitle: title, eventDate: date, bracketLink: bracket, rounds: currentRounds })
        });
        const idx = allEvents.findIndex(e => e.id === event.id);
        if (idx !== -1) {
            allEvents[idx] = { ...allEvents[idx], eventTitle: title, eventDate: date, bracketLink: bracket, rounds: currentRounds };
            selectedEvent = allEvents[idx];
        }
        renderEventList();
        showToast("Event saved", "success");
    });

    deleteBtn.addEventListener("click", async () => {
        if (!confirm(`Delete "${event.eventTitle}"? Sets recorded under it will remain.`)) return;
        await fetch(`/api/events/${event.id}`, { method: "DELETE" });
        allEvents = allEvents.filter(e => e.id !== event.id);
        selectedEvent = null;
        renderEventList();
        document.getElementById("events-right").innerHTML = `
            <div class="events-placeholder">
                <div class="events-placeholder-icon">📅</div>
                <p>Select an event or create a new one</p>
            </div>`;
        showToast("Event deleted");
    });
}

// =====================
// New Event
// =====================
function setupNewEvent() {
    document.getElementById("new-event-btn").addEventListener("click", async () => {
        const event = await fetch("/api/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ eventTitle: "New Event", eventDate: "", rounds: [] })
        }).then(r => r.json());
        allEvents.push(event);
        selectEvent(event);
        renderEventList();
        showToast("Event created");
    });
}

// =====================
// Import Modal
// =====================
function setupImportModal() {
    document.getElementById("import-url-btn").addEventListener("click", openImportModal);
    document.getElementById("import-modal-close").addEventListener("click", closeImportModal);
    document.getElementById("import-modal-cancel").addEventListener("click", closeImportModal);
    document.getElementById("import-modal-overlay").addEventListener("click", e => {
        if (e.target === document.getElementById("import-modal-overlay")) closeImportModal();
    });

    document.getElementById("import-preview-btn").addEventListener("click", runPreview);
    document.getElementById("import-url-input").addEventListener("keydown", e => {
        if (e.key === "Enter") runPreview();
    });

    // Auto-detect source as user types
    document.getElementById("import-url-input").addEventListener("input", e => {
        const url = e.target.value.trim();
        const badge = document.getElementById("import-source-badge");
        if (url.includes("start.gg") || url.includes("smash.gg")) {
            badge.textContent = "🎮 Detected: start.gg — requires API key in Settings";
            badge.style.color = "var(--primary)";
        } else if (url.includes("challonge.com")) {
            badge.textContent = "🏆 Detected: Challonge";
            badge.style.color = "var(--success)";
        } else {
            badge.textContent = "";
        }
    });

    document.getElementById("import-do-btn").addEventListener("click", () => {
        if (!previewResult) return;
        if (previewResult.unmatched_names.length > 0) {
            openResolutionModal(previewResult);
        } else {
            doImport(previewResult, {}, false);
        }
    });
}

function openImportModal() {
    // Reset state
    document.getElementById("import-url-input").value = "";
    document.getElementById("import-source-badge").textContent = "";
    document.getElementById("import-step-preview").style.display = "none";
    document.getElementById("import-step-preview").innerHTML = "";
    document.getElementById("import-do-btn").style.display = "none";
    previewResult = null;
    document.getElementById("import-modal-overlay").classList.add("open");
}

function closeImportModal() {
    document.getElementById("import-modal-overlay").classList.remove("open");
    previewResult = null;
}

async function runPreview() {
    const url = document.getElementById("import-url-input").value.trim();
    if (!url) return;

    const btn = document.getElementById("import-preview-btn");
    btn.textContent = "Loading...";
    btn.disabled = true;

    const res = await fetch("/api/events/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
    }).then(r => r.json());

    btn.textContent = "Preview";
    btn.disabled = false;

    if (res.error) {
        showToast(res.error, "error");
        return;
    }

    previewResult = res;
    renderImportPreview(res);
}

function renderImportPreview(data) {
    const area = document.getElementById("import-step-preview");
    area.style.display = "block";

    const isStartgg = data.source === "startgg";
    const headerLabel = isStartgg
        ? `<span style="color:var(--primary);font-size:11px;font-weight:700">start.gg</span> · ${data.tournament_name}`
        : `<span style="color:var(--success);font-size:11px;font-weight:700">Challonge</span>`;

    // Existing event warnings
    const existingWarnings = data.sub_events
        .filter(e => e.existing_event)
        .map(e => `
            <div class="import-warning" style="margin-bottom:6px">
                ⚠ "<strong>${e.title}</strong>" was already imported.
                Importing again will replace its sets.
            </div>
        `).join("");

    const unmatchedWarning = data.unmatched_names.length > 0 ? `
        <div style="padding:8px 12px;background:rgba(224,160,80,0.08);border:1px solid var(--warning);border-radius:8px;font-size:12px;color:var(--warning);margin-bottom:8px">
            ⚠ ${data.unmatched_names.length} player name${data.unmatched_names.length !== 1 ? "s" : ""} not found in database — you'll resolve these before importing.
        </div>
    ` : "";

    // Sub-event previews
    const subEventPreviews = data.sub_events.map(sub => `
        <div class="import-preview" style="margin-bottom:10px">
            <div class="import-preview-header">
                <div class="import-preview-title">${sub.title}</div>
                <div class="import-preview-meta">${sub.matches.length} matches · ${sub.unique_rounds.length} rounds</div>
            </div>
            <div class="import-match-list">
                ${sub.matches.slice(0, 8).map(m => `
                    <div class="import-match-row">
                        <span class="import-round-badge">${m.round}</span>
                        <span class="import-match-players">
                            <span class="${m.p1_found ? "player-found" : "player-missing"}">${m.p1_name}</span>
                            <span style="color:var(--on-surface-dim)"> vs </span>
                            <span class="${m.p2_found ? "player-found" : "player-missing"}">${m.p2_name}</span>
                        </span>
                        ${m.winner_name ? `<span class="import-match-winner">🏆 ${m.winner_name}</span>` : ""}
                    </div>
                `).join("")}
                ${sub.matches.length > 8 ? `
                    <div style="padding:6px 14px;font-size:11px;color:var(--on-surface-dim);border-top:1px solid var(--outline)">
                        + ${sub.matches.length - 8} more matches
                    </div>
                ` : ""}
            </div>
        </div>
    `).join("");

    area.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--outline)">
            <div style="flex:1;font-size:12px;color:var(--on-surface-dim)">${headerLabel}</div>
            <div style="font-size:12px;color:var(--on-surface-dim)">${data.sub_events.length} event${data.sub_events.length !== 1 ? "s" : ""} · ${data.total_matches} total matches</div>
        </div>
        ${existingWarnings}
        ${unmatchedWarning}
        <div style="max-height:340px;overflow-y:auto">
            ${subEventPreviews}
        </div>
    `;

    // Show import button
    const doBtn = document.getElementById("import-do-btn");
    const hasExisting = data.sub_events.some(e => e.existing_event);
    doBtn.textContent = data.unmatched_names.length > 0
        ? "Resolve Players & Import"
        : `Import ${data.sub_events.length > 1 ? `${data.sub_events.length} Events` : "Event"}`;
    if (hasExisting) doBtn.textContent += " (re-import)";
    doBtn.style.display = "block";
}

// =====================
// Resolution Modal
// =====================
function setupResolutionModal() {
    document.getElementById("resolution-modal-close").addEventListener("click", closeResolutionModal);
    document.getElementById("resolution-cancel-btn").addEventListener("click", closeResolutionModal);
    document.getElementById("resolution-confirm-btn").addEventListener("click", confirmResolution);
    document.getElementById("resolution-modal-overlay").addEventListener("click", e => {
        if (e.target === document.getElementById("resolution-modal-overlay")) closeResolutionModal();
    });
}

function openResolutionModal(data, reimport = false) {
    pendingImport = { data, reimport };
    const list = document.getElementById("resolution-player-list");

    list.innerHTML = data.unmatched_names.map(name => `
        <div class="resolution-item" data-name="${escAttr(name)}">
            <div class="resolution-name">⚠ "${name}"</div>
            <div class="resolution-name-hint">Not found in player database</div>
            <div class="resolution-actions">
                <button class="resolution-mode-btn selected" data-mode="create" data-for="${escAttr(name)}">Create New</button>
                <button class="resolution-mode-btn" data-mode="merge" data-for="${escAttr(name)}">Merge with Existing</button>
                <input type="text" class="resolution-name-input" data-for="${escAttr(name)}"
                    placeholder="Player name" value="${escAttr(name)}" style="display:block">
                <select class="resolution-merge-select" data-for="${escAttr(name)}" style="display:none">
                    <option value="">Select player...</option>
                    ${allPlayers.map(p => `<option value="${p.id}">${p.name}${(p.aliases||[]).length ? ` (${p.aliases.join(", ")})` : ""}</option>`).join("")}
                </select>
            </div>
        </div>
    `).join("");

    list.querySelectorAll(".resolution-mode-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const forName = btn.dataset.for;
            const item = list.querySelector(`.resolution-item[data-name="${CSS.escape(forName)}"]`);
            const mode = btn.dataset.mode;
            item.querySelectorAll(".resolution-mode-btn").forEach(b => b.classList.toggle("selected", b.dataset.mode === mode));
            item.querySelector(".resolution-name-input").style.display = mode === "create" ? "block" : "none";
            item.querySelector(".resolution-merge-select").style.display = mode === "merge" ? "block" : "none";
        });
    });

    document.getElementById("resolution-modal-overlay").classList.add("open");
}

function closeResolutionModal() {
    document.getElementById("resolution-modal-overlay").classList.remove("open");
    pendingImport = null;
}

async function confirmResolution() {
    if (!pendingImport) return;
    const { data, reimport } = pendingImport;
    const list = document.getElementById("resolution-player-list");
    const resolutions = {};
    let valid = true;

    list.querySelectorAll(".resolution-item").forEach(item => {
        const name = item.dataset.name;
        const activeMode = item.querySelector(".resolution-mode-btn.selected")?.dataset.mode;
        if (activeMode === "create") {
            const newName = item.querySelector(".resolution-name-input").value.trim();
            if (!newName) { showToast("Enter a name for all new players", "error"); valid = false; return; }
            resolutions[name] = { action: "create", name: newName };
        } else if (activeMode === "merge") {
            const playerId = parseInt(item.querySelector(".resolution-merge-select").value);
            if (!playerId) { showToast("Select a player to merge with", "error"); valid = false; return; }
            resolutions[name] = { action: "merge", player_id: playerId };
        }
    });

    if (!valid) return;
    closeResolutionModal();
    await doImport(data, resolutions, reimport);
}

async function doImport(data, resolutions, reimport) {
    const doBtn = document.getElementById("import-do-btn");
    if (doBtn) { doBtn.textContent = "Importing..."; doBtn.disabled = true; }

    const hasExisting = data.sub_events.some(e => e.existing_event);

    const res = await fetch("/api/events/import/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            sub_events: data.sub_events,
            resolutions,
            reimport: reimport || hasExisting,
        })
    }).then(r => r.json());

    if (!res.ok) {
        showToast(res.error || "Import failed", "error");
        if (doBtn) { doBtn.textContent = "Import"; doBtn.disabled = false; }
        return;
    }

    await fetchEvents();
    await fetchPlayers(); // refresh aliases

    // Select the first imported event
    const firstEventId = res.results[0]?.event_id;
    if (firstEventId) {
        const ev = allEvents.find(e => e.id === firstEventId);
        if (ev) selectEvent(ev);
    }

    closeImportModal();

    const msg = res.events_created > 1
        ? `Imported ${res.total_imported} matches across ${res.events_created} events`
        : `Imported ${res.total_imported} matches`;
    showToast(msg, "success");
}

// =====================
// Round Mapping Tab
// =====================
let roundMapData = {};

async function loadRoundMap() {
    roundMapData = await fetch("/api/events/round-map").then(r => r.json());
    renderRoundMapTable();
}

function renderRoundMapTable() {
    const table = document.getElementById("round-map-table");
    if (!table) return;
    table.innerHTML = Object.entries(roundMapData).map(([from, to]) => `
        <div class="round-map-row" data-from="${escAttr(from)}">
            <input type="text" class="map-from" value="${escAttr(from)}" placeholder="Source round name">
            <span class="round-map-arrow">→</span>
            <input type="text" class="map-to" value="${escAttr(to)}" placeholder="Your round name">
            <button class="round-map-del">✕</button>
        </div>
    `).join("");

    table.querySelectorAll(".round-map-del").forEach(btn => {
        btn.addEventListener("click", () => btn.closest(".round-map-row").remove());
    });

    document.getElementById("add-map-row-btn")?.addEventListener("click", () => {
        const row = document.createElement("div");
        row.className = "round-map-row";
        row.innerHTML = `
            <input type="text" class="map-from" placeholder="Source round name">
            <span class="round-map-arrow">→</span>
            <input type="text" class="map-to" placeholder="Your round name">
            <button class="round-map-del">✕</button>
        `;
        row.querySelector(".round-map-del").addEventListener("click", () => row.remove());
        table.appendChild(row);
    });

    document.getElementById("save-round-map-btn")?.addEventListener("click", async () => {
        const newMap = {};
        table.querySelectorAll(".round-map-row").forEach(row => {
            const from = row.querySelector(".map-from").value.trim();
            const to = row.querySelector(".map-to").value.trim();
            if (from && to) newMap[from] = to;
        });
        await fetch("/api/events/round-map", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newMap)
        });
        roundMapData = newMap;
        showToast("Round mapping saved", "success");
    });
}

// =====================
// Helpers
// =====================
function escAttr(str) {
    return (str || "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

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