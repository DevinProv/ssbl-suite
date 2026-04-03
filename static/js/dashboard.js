let state = {
    eventID: null,
    setID: null,
    player1: { id: null, name: "", char: "", color: "", score: 0 },
    player2: { id: null, name: "", char: "", color: "", score: 0 },
    bracketRound: "",
    gameNumber: 1
}
let overlayWs = null;
let availableChars = [];
let suppressBlur = false;
let currentEventRounds = [];
let allEvents = [];
let allTemplates = [];

// =====================
// Overlay WS
// =====================
function connectOverlayWS() {
    overlayWs = new WebSocket(`ws://${location.host}/ws/overlay`);
    overlayWs.onclose = () => setTimeout(connectOverlayWS, 2000);
}
connectOverlayWS();

function pushOverlayState() {
    const payload = {
        player1: {
            name: state.player1.name || "Player 1",
            char: state.player1.char || "",
            color: state.player1.color || "",
            score: state.player1.score
        },
        player2: {
            name: state.player2.name || "Player 2",
            char: state.player2.char || "",
            color: state.player2.color || "",
            score: state.player2.score
        },
        round: state.bracketRound || "",
        event: (() => {
            const ev = allEvents.find(e => e.id === state.eventID);
            return ev ? ev.eventTitle : "";
        })()
    };
    sessionStorage.setItem("ssbl_state", JSON.stringify(state));
    fetch("/api/overlay/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
}

// =====================
// Player Cards
// =====================
function createPlayerCard(playerNum) {
    const template = document.getElementById("player-card-template");
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector(".card");
    card.id = `player${playerNum}-card`;
    clone.querySelector(".card-title").textContent = `Player ${playerNum}`;
    clone.querySelector(".card-title").dataset.player = playerNum;
    clone.querySelector(".player-input").dataset.player = playerNum;
    clone.querySelector(".char-select").dataset.player = playerNum;
    clone.querySelector(".color-select").dataset.player = playerNum;
    clone.querySelector(".winner-btn").dataset.player = playerNum;
    clone.querySelector(".save-player-btn").dataset.player = playerNum;
    document.getElementById("player-cards-container").appendChild(clone);
}

async function restorePlayerUI() {
    for (const playerNum of [1, 2]) {
        const p = state[`player${playerNum}`];
        if (!p.name) continue;
        const card = document.getElementById(`player${playerNum}-card`);
        card.querySelector(".card-title").textContent = p.name;
        card.querySelector(".player-input").value = p.name;
        if (p.char) {
            card.querySelector(".char-select").value = p.char;
            await fetchCharColors(playerNum, p.char);
            if (p.color) card.querySelector(".color-select").value = p.color;
        }
        updateCharacterImage(playerNum);
        card.querySelector(".player-score").textContent = p.score;
        if (p.id !== null) {
            const saveBtn = card.querySelector(".save-player-btn");
            saveBtn.style.display = "block";
            saveBtn.textContent = "🔄";
            saveBtn.title = "Update Defaults";
        }
    }
    if (state.bracketRound) {
        const roundSel = document.getElementById("round-select");
        // Will be set after events load
    }
    if (state.setID) {
        document.getElementById("start-set-btn").style.display = "none";
        document.getElementById("end-set-btn").style.display = "block";
        updateUndoBtn();
    }
}

// =====================
// Events & Rounds
// =====================
async function fetchEvents() {
    const response = await fetch("/api/events");
    allEvents = await response.json();
    renderEventSelect();
}

function renderEventSelect() {
    const eventSelect = document.getElementById("event-select");
    eventSelect.innerHTML = "<option value=''>Select Event</option>";
    allEvents.forEach(event => {
        const option = document.createElement("option");
        option.value = event.id;
        option.textContent = event.eventTitle;
        eventSelect.appendChild(option);
    });
    if (state.eventID) {
        eventSelect.value = state.eventID;
        loadRoundsForEvent(state.eventID);
    } else if (allEvents.length > 0) {
        state.eventID = allEvents[0].id;
        eventSelect.value = allEvents[0].id;
        loadRoundsForEvent(allEvents[0].id);
    }
}

function loadRoundsForEvent(eventID) {
    const event = allEvents.find(e => e.id === parseInt(eventID));
    currentEventRounds = event ? (event.rounds || []) : [];
    renderRoundSelect();
}

function renderRoundSelect() {
    const roundSel = document.getElementById("round-select");
    roundSel.innerHTML = "<option value=''>Select Round</option>";
    currentEventRounds.forEach(r => {
        const opt = document.createElement("option");
        opt.value = r;
        opt.textContent = r;
        roundSel.appendChild(opt);
    });
    if (state.bracketRound && currentEventRounds.includes(state.bracketRound)) {
        roundSel.value = state.bracketRound;
    }
}

async function fetchTemplates() {
    allTemplates = await fetch("/api/templates").then(r => r.json());
}

// =====================
// Events Modal
// =====================
function openEventsModal() {
    renderEventsModalList();
    renderNewEventTemplates();
    document.getElementById("events-modal-overlay").classList.add("open");
}

function closeEventsModal() {
    document.getElementById("events-modal-overlay").classList.remove("open");
}

function renderEventsModalList() {
    const list = document.getElementById("modal-event-list");
    if (allEvents.length === 0) {
        list.innerHTML = `<div style="color:var(--on-surface-dim);font-size:12px;padding:12px">No events yet.</div>`;
        return;
    }
    list.innerHTML = allEvents.map(e => `
        <div class="modal-event-item ${e.id === state.eventID ? "selected" : ""}" data-id="${e.id}">
            <div class="modal-event-title">${e.eventTitle}</div>
            <div class="modal-event-date">${e.eventDate || ""}</div>
            <button class="modal-event-delete" data-id="${e.id}" title="Delete event">🗑</button>
        </div>
    `).join("");

    list.querySelectorAll(".modal-event-item").forEach(item => {
        item.addEventListener("click", e => {
            if (e.target.classList.contains("modal-event-delete")) return;
            const id = parseInt(item.dataset.id);
            state.eventID = id;
            document.getElementById("event-select").value = id;
            loadRoundsForEvent(id);
            pushOverlayState();
            closeEventsModal();
        });
    });

    list.querySelectorAll(".modal-event-delete").forEach(btn => {
        btn.addEventListener("click", async e => {
            e.stopPropagation();
            const id = parseInt(btn.dataset.id);
            if (!confirm("Delete this event? Sets recorded under it will remain.")) return;
            await fetch(`/api/events/${id}`, { method: "DELETE" });
            allEvents = allEvents.filter(ev => ev.id !== id);
            if (state.eventID === id) {
                state.eventID = allEvents[0]?.id || null;
                loadRoundsForEvent(state.eventID);
            }
            renderEventSelect();
            renderEventsModalList();
        });
    });
}

function renderNewEventTemplates() {
    const grid = document.getElementById("new-event-templates");
    grid.innerHTML = allTemplates.map(t => `
        <div class="template-item" data-id="${t.id}">
            <span class="template-item-name">${t.name}</span>
            <span class="template-item-count">${t.rounds.length} rounds</span>
        </div>
    `).join("");

    let selectedTemplate = null;
    grid.querySelectorAll(".template-item").forEach(item => {
        item.addEventListener("click", () => {
            grid.querySelectorAll(".template-item").forEach(i => i.style.borderColor = "");
            item.style.borderColor = "var(--primary)";
            selectedTemplate = allTemplates.find(t => t.id === parseInt(item.dataset.id));
            grid._selected = selectedTemplate;
        });
    });
}

async function createEvent() {
    const title = document.getElementById("new-event-title").value.trim();
    if (!title) { alert("Title is required"); return; }

    const date = document.getElementById("new-event-date").value;
    const bracket = document.getElementById("new-event-bracket").value.trim();
    const templateGrid = document.getElementById("new-event-templates");
    const rounds = templateGrid._selected ? templateGrid._selected.rounds : [];

    const event = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventTitle: title, eventDate: date, bracketLink: bracket, rounds })
    }).then(r => r.json());

    allEvents.push(event);
    state.eventID = event.id;
    currentEventRounds = event.rounds;

    renderEventSelect();
    renderRoundSelect();
    pushOverlayState();

    // Reset form
    document.getElementById("new-event-title").value = "";
    document.getElementById("new-event-date").value = "";
    document.getElementById("new-event-bracket").value = "";
    templateGrid._selected = null;
    templateGrid.querySelectorAll(".template-item").forEach(i => i.style.borderColor = "");

    closeEventsModal();
}

// =====================
// Rounds Modal
// =====================
let roundsModalRounds = [];

function openRoundsModal() {
    const event = allEvents.find(e => e.id === state.eventID);
    if (!event) { alert("Select an event first"); return; }

    roundsModalRounds = [...(event.rounds || [])];
    document.getElementById("rounds-modal-event-name").textContent = event.eventTitle;
    renderRoundList();
    renderRoundsTemplates();
    document.getElementById("rounds-modal-overlay").classList.add("open");
}

function closeRoundsModal() {
    document.getElementById("rounds-modal-overlay").classList.remove("open");
}

function renderRoundList() {
    const list = document.getElementById("round-list");
    if (roundsModalRounds.length === 0) {
        list.innerHTML = `<div style="color:var(--on-surface-dim);font-size:12px;padding:12px">No rounds yet. Add one below or load a template.</div>`;
        return;
    }
    list.innerHTML = roundsModalRounds.map((r, i) => `
        <div class="round-item" draggable="true" data-index="${i}">
            <span class="round-drag-handle">⠿</span>
            <span class="round-item-name">${r}</span>
            <button class="round-item-delete" data-index="${i}">✕</button>
        </div>
    `).join("");

    // Delete buttons
    list.querySelectorAll(".round-item-delete").forEach(btn => {
        btn.addEventListener("click", () => {
            roundsModalRounds.splice(parseInt(btn.dataset.index), 1);
            renderRoundList();
        });
    });

    // Drag to reorder
    let dragSrc = null;
    list.querySelectorAll(".round-item").forEach(item => {
        item.addEventListener("dragstart", () => {
            dragSrc = parseInt(item.dataset.index);
            item.style.opacity = "0.5";
        });
        item.addEventListener("dragend", () => { item.style.opacity = ""; });
        item.addEventListener("dragover", e => e.preventDefault());
        item.addEventListener("drop", () => {
            const target = parseInt(item.dataset.index);
            if (dragSrc === target) return;
            const moved = roundsModalRounds.splice(dragSrc, 1)[0];
            roundsModalRounds.splice(target, 0, moved);
            renderRoundList();
        });
    });
}

function renderRoundsTemplates() {
    const grid = document.getElementById("rounds-templates");
    grid.innerHTML = allTemplates.map(t => `
        <div class="template-item" data-id="${t.id}" style="position:relative">
            <span class="template-item-name">${t.name}</span>
            <span class="template-item-count">${t.rounds.length} rounds</span>
            ${!t.is_builtin ? `<button class="template-item-delete" data-id="${t.id}" title="Delete template">✕</button>` : ""}
        </div>
    `).join("");

    grid.querySelectorAll(".template-item").forEach(item => {
        item.addEventListener("click", e => {
            if (e.target.classList.contains("template-item-delete")) return;
            const t = allTemplates.find(t => t.id === parseInt(item.dataset.id));
            if (t) { roundsModalRounds = [...t.rounds]; renderRoundList(); }
        });
    });

    grid.querySelectorAll(".template-item-delete").forEach(btn => {
        btn.addEventListener("click", async e => {
            e.stopPropagation();
            await fetch(`/api/templates/${btn.dataset.id}`, { method: "DELETE" });
            allTemplates = allTemplates.filter(t => t.id !== parseInt(btn.dataset.id));
            renderRoundsTemplates();
            renderNewEventTemplates();
        });
    });
}

async function saveRounds() {
    if (!state.eventID) return;
    console.log("Saving rounds:", roundsModalRounds, "to event:", state.eventID);
    await fetch(`/api/events/${state.eventID}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rounds: roundsModalRounds })
    });
    const idx = allEvents.findIndex(e => e.id === state.eventID);
    if (idx !== -1) allEvents[idx].rounds = roundsModalRounds;
    currentEventRounds = [...roundsModalRounds];
    renderRoundSelect();
    closeRoundsModal();
}

async function saveAsTemplate() {
    const name = prompt("Template name:");
    if (!name) return;
    const t = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rounds: roundsModalRounds })
    }).then(r => r.json());
    allTemplates.push(t);
    renderRoundsTemplates();
    renderNewEventTemplates();
    alert(`Saved as "${name}"`);
}

// =====================
// Characters
// =====================
async function fetchChars() {
    const response = await fetch("api/characters");
    availableChars = await response.json();
    document.querySelectorAll(".char-select").forEach(select => {
        select.innerHTML = "<option value=''>Select Character</option>";
        availableChars.forEach(char => {
            const option = document.createElement("option");
            option.value = char;
            option.textContent = char.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
            select.appendChild(option);
        });
    });
}

async function fetchCharColors(playerNum, charName) {
    const response = await fetch(`api/characters/${charName}/colors`);
    const colors = await response.json();
    const card = document.getElementById(`player${playerNum}-card`);
    const colorSelect = card.querySelector(".color-select");
    colorSelect.innerHTML = "<option value=''>Select Color</option>";
    colors.forEach(color => {
        const option = document.createElement("option");
        option.value = color;
        option.textContent = color.replace(/\.[^/.]+$/, "").replace(/\b\w/g, c => c.toUpperCase());
        colorSelect.appendChild(option);
    });
    if (state[`player${playerNum}`].color) colorSelect.value = state[`player${playerNum}`].color;
}

// =====================
// Autocomplete
// =====================
function showAutoComplete(playerNum, players) {
    const card = document.getElementById(`player${playerNum}-card`);
    const results = card.querySelector(".autocomplete-results");
    results.innerHTML = "";
    players.forEach(player => {
        const item = document.createElement("div");
        item.classList.add("autocomplete-item");
        item.textContent = player.name;
        item.addEventListener("click", () => selectPlayer(playerNum, player));
        results.appendChild(item);
    });
}

function clearAutoComplete(playerNum) {
    document.getElementById(`player${playerNum}-card`).querySelector(".autocomplete-results").innerHTML = "";
}

async function selectPlayer(playerNum, player) {
    suppressBlur = true;
    state[`player${playerNum}`].id = player.id;
    state[`player${playerNum}`].name = player.name;
    state[`player${playerNum}`].char = player.defaultChar || "";
    state[`player${playerNum}`].color = player.defaultCharColor || "";
    const card = document.getElementById(`player${playerNum}-card`);
    card.querySelector(".player-input").value = player.name;
    card.querySelector(".card-title").textContent = player.name;
    clearAutoComplete(playerNum);
    disableNameEdit(playerNum);
    if (player.defaultChar) {
        card.querySelector(".char-select").value = player.defaultChar;
        await fetchCharColors(playerNum, player.defaultChar);
        if (player.defaultCharColor) card.querySelector(".color-select").value = player.defaultCharColor;
    }
    updateCharacterImage(playerNum);
    const saveBtn = card.querySelector(".save-player-btn");
    saveBtn.style.display = "block";
    saveBtn.textContent = "🔄";
    saveBtn.title = "Update Defaults";
    pushOverlayState();
    setTimeout(() => { suppressBlur = false; }, 200);
}

function enableNameEdit(playerNum) {
    const card = document.getElementById(`player${playerNum}-card`);
    const title = card.querySelector(".card-title");
    const wrapper = card.querySelector(".player-input-wrapper");
    const input = card.querySelector(".player-input");
    input.value = title.textContent === `Player ${playerNum}` ? "" : title.textContent;
    title.style.display = "none";
    wrapper.style.display = "flex";
    input.focus();
    input.select();
}

function disableNameEdit(playerNum) {
    const card = document.getElementById(`player${playerNum}-card`);
    const title = card.querySelector(".card-title");
    const wrapper = card.querySelector(".player-input-wrapper");
    const input = card.querySelector(".player-input");
    const ghost = card.querySelector(".player-ghost");
    if (input.value.trim()) title.textContent = input.value.trim();
    wrapper.style.display = "none";
    title.style.display = "block";
    if (ghost) ghost.value = "";
    clearAutoComplete(playerNum);
}

async function savePlayer(playerNum) {
    const card = document.getElementById(`player${playerNum}-card`);
    const name = card.querySelector(".player-input").value || card.querySelector(".card-title").textContent;
    const char = card.querySelector(".char-select").value;
    const color = card.querySelector(".color-select").value;
    const data = { name, defaultChar: char, defaultCharColor: color };
    let response;
    if (state[`player${playerNum}`].id === null) {
        response = await fetch("/api/players", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
    } else {
        response = await fetch(`/api/players/${state[`player${playerNum}`].id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
    }
    const player = await response.json();
    state[`player${playerNum}`].id = player.id;
    state[`player${playerNum}`].name = player.name;
    state[`player${playerNum}`].char = player.defaultChar;
    state[`player${playerNum}`].color = player.defaultCharColor;
    card.querySelector(".card-title").textContent = player.name;
    card.querySelector(".save-player-btn").style.display = "none";
    disableNameEdit(playerNum);
}

// =====================
// Set Management
// =====================
async function startSet() {
    if (!state.eventID || !state.bracketRound || !state.player1.id || !state.player2.id) {
        alert("Please select an event, round, and both players before starting the set.");
        return;
    }
    let vodFilename = null, vodTimestampStart = null;
    const obsStatus = await fetch("/api/obs/status").then(r => r.json());
    if (obsStatus.connected) {
        const [filenameRes, timestampRes] = await Promise.all([
            fetch("/api/obs/last-recording").then(r => r.json()),
            fetch("/api/obs/timestamp").then(r => r.json())
        ]);
        vodFilename = filenameRes.filename ?? null;
        vodTimestampStart = timestampRes.duration ?? null;
    }
    const response = await fetch("/api/sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            eventID: state.eventID,
            bracketRound: state.bracketRound,
            player1ID: state.player1.id,
            player2ID: state.player2.id,
            vodFilename,
            vodTimestampStart,
            vodTimestampEnd: null,
            winnerID: null
        })
    });
    const match_set = await response.json();
    state.setID = match_set.id;
    document.getElementById("start-set-btn").style.display = "none";
    document.getElementById("end-set-btn").style.display = "block";
    updateUndoBtn();
    sessionStorage.setItem("ssbl_state", JSON.stringify(state));
}

async function endSet() {
    let vodTimestampEnd = null;
    const obsStatus = await fetch("/api/obs/status").then(r => r.json());
    if (obsStatus.connected) {
        const timestampRes = await fetch("/api/obs/timestamp").then(r => r.json());
        vodTimestampEnd = timestampRes.duration ?? null;
    }
    await fetch(`/api/sets/${state.setID}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            vodTimestampEnd,
            winnerID: state.player1.score > state.player2.score ? state.player1.id : state.player2.id
        })
    });
    state.setID = null;
    state.player1.score = 0;
    state.player2.score = 0;
    document.querySelector("#player1-card .player-score").textContent = "0";
    document.querySelector("#player2-card .player-score").textContent = "0";
    document.getElementById("start-set-btn").style.display = "block";
    document.getElementById("end-set-btn").style.display = "none";
    updateUndoBtn();
    pushOverlayState();
}

async function getCurrentGameNumber() {
    const response = await fetch(`/api/sets/${state.setID}/games`);
    const games = await response.json();
    return games.length + 1;
}

async function addMatch(winnerID) {
    await fetch(`/api/sets/${state.setID}/games`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            setID: state.setID,
            gameNumber: await getCurrentGameNumber(),
            player1Char: state.player1.char,
            player2Char: state.player2.char,
            winnerID
        })
    });
}

async function updateScore(playerNum, delta) {
    if (!state.setID) return; // guard — no set active
    state[`player${playerNum}`].score += delta;
    await addMatch(state[`player${playerNum}`].id);
    document.getElementById(`player${playerNum}-card`).querySelector(".player-score").textContent = state[`player${playerNum}`].score;
    updateUndoBtn();
    pushOverlayState();
}

// Undo Last Game
async function undoLastGame() {
    if (!state.setID) return;
    const res = await fetch(`/api/sets/${state.setID}/games/last`, {
        method: "DELETE"
    }).then(r => r.json());
 
    if (!res.ok) return;
    const winnerID = res.winnerID;
    for (const playerNum of [1, 2]) {
        if (state[`player${playerNum}`].id === winnerID) {
            state[`player${playerNum}`].score = Math.max(0, state[`player${playerNum}`].score - 1);
            document.getElementById(`player${playerNum}-card`).querySelector(".player-score").textContent = state[`player${playerNum}`].score;
            break;
        }
    }
    updateUndoBtn();
    pushOverlayState();
}

// Undo Button
function updateUndoBtn() {
    const btn = document.getElementById("undo-game-btn");
    if (!btn) return;
    const hasGames = state.player1.score > 0 || state.player2.score > 0;
    btn.style.display = state.setID && hasGames ? "inline-flex" : "none";
}

function updateCharacterImage(playerNum) {
    const card = document.getElementById(`player${playerNum}-card`);
    const placeholder = card.querySelector(".char-image-placeholder");
    const img = card.querySelector(".char-image");
    const char = state[`player${playerNum}`].char;
    const color = state[`player${playerNum}`].color;
    if (char && color) {
        img.src = `/api/characters/${char}/${color}/image`;
        placeholder.style.display = "none";
        img.style.display = "block";
    } else {
        img.src = "";
        placeholder.style.display = "flex";
        img.style.display = "none";
    }
}

// =====================
// DOM Ready
// =====================
document.addEventListener("DOMContentLoaded", async () => {
    const saved = sessionStorage.getItem("ssbl_state");
    if (saved) {
        try { Object.assign(state, JSON.parse(saved)); } catch(e) {}
    }

    createPlayerCard(1);
    createPlayerCard(2);
    await restorePlayerUI();
    await Promise.all([fetchEvents(), fetchChars(), fetchTemplates()]);
    // Undo button Listener
    document.getElementById("undo-game-btn").addEventListener("click", undoLastGame);
    // Event select change
    document.getElementById("event-select").addEventListener("change", e => {
        state.eventID = e.target.value ? parseInt(e.target.value) : null;
        loadRoundsForEvent(state.eventID);
        state.bracketRound = "";
        pushOverlayState();
    });

    // Round select change
    document.getElementById("round-select").addEventListener("change", e => {
        state.bracketRound = e.target.value;
        pushOverlayState();
    });

    // Edit Events button
    document.getElementById("edit-events-btn").addEventListener("click", openEventsModal);

    // Edit Rounds button
    document.getElementById("edit-rounds-btn").addEventListener("click", openRoundsModal);

    // Events modal
    document.getElementById("events-modal-close").addEventListener("click", closeEventsModal);
    document.getElementById("events-modal-cancel").addEventListener("click", closeEventsModal);
    document.getElementById("create-event-btn").addEventListener("click", createEvent);
    document.getElementById("events-modal-overlay").addEventListener("click", e => {
        if (e.target === document.getElementById("events-modal-overlay")) closeEventsModal();
    });

    // Rounds modal
    document.getElementById("rounds-modal-close").addEventListener("click", closeRoundsModal);
    document.getElementById("rounds-modal-cancel").addEventListener("click", closeRoundsModal);
    document.getElementById("save-rounds-btn").addEventListener("click", saveRounds);
    document.getElementById("save-as-template-btn").addEventListener("click", saveAsTemplate);
    document.getElementById("rounds-modal-overlay").addEventListener("click", e => {
        if (e.target === document.getElementById("rounds-modal-overlay")) closeRoundsModal();
    });

    document.getElementById("add-round-btn").addEventListener("click", () => {
        const input = document.getElementById("new-round-input");
        const val = input.value.trim();
        if (!val) return;
        roundsModalRounds.push(val);
        renderRoundList();
        input.value = "";
    });
    document.getElementById("new-round-input").addEventListener("keydown", e => {
        if (e.key === "Enter") document.getElementById("add-round-btn").click();
    });

    // Autocomplete
    document.getElementById("player-cards-container").addEventListener("input", async (e) => {
        if (!e.target.classList.contains("player-input")) return;
        const playerNum = e.target.dataset.player;
        const query = e.target.value.trim();
        const card = document.getElementById(`player${playerNum}-card`);
        const ghost = card.querySelector(".player-ghost");
        if (query.length < 1) { clearAutoComplete(playerNum); if (ghost) ghost.value = ""; return; }
        const response = await fetch(`/api/players/search?q=${query}`);
        const players = await response.json();
        const exactMatch = players.find(p => p.name.toLowerCase() === query.toLowerCase());
        if (exactMatch) { if (ghost) ghost.value = ""; await selectPlayer(playerNum, exactMatch); return; }
        if (players.length > 0) {
            const topMatch = players[0].name;
            if (ghost) ghost.value = topMatch.toLowerCase().startsWith(query.toLowerCase()) ? topMatch : "";
        } else { if (ghost) ghost.value = ""; }
        showAutoComplete(playerNum, players);
        const saveBtn = card.querySelector(".save-player-btn");
        saveBtn.style.display = players.length === 0 && query.length > 0 ? "block" : "none";
        if (players.length === 0) { saveBtn.textContent = "💾"; saveBtn.title = "Save New Player"; }
    });

    document.getElementById("player-cards-container").addEventListener("focusout", (e) => {
        if (!e.target.classList.contains("player-input")) return;
        if (suppressBlur) return;
        setTimeout(() => disableNameEdit(e.target.dataset.player), 150);
    });

    document.getElementById("player-cards-container").addEventListener("keydown", (e) => {
        if (!e.target.classList.contains("player-input")) return;
        const playerNum = e.target.dataset.player;
        const card = document.getElementById(`player${playerNum}-card`);
        const ghost = card.querySelector(".player-ghost");
        if (e.key === "Tab" && ghost?.value) { e.preventDefault(); e.target.value = ghost.value; ghost.value = ""; e.target.dispatchEvent(new Event("input", { bubbles: true })); }
        if (e.key === "Enter") disableNameEdit(playerNum);
        if (e.key === "ArrowRight") {
            if (e.target.selectionStart === e.target.value.length && ghost?.value) {
                e.target.value = ghost.value; ghost.value = ""; e.target.dispatchEvent(new Event("input", { bubbles: true }));
            }
        }
    });

    document.getElementById("player-cards-container").addEventListener("change", async (e) => {
        const playerNum = e.target.dataset.player;
        const card = document.getElementById(`player${playerNum}-card`);
        if (e.target.classList.contains("char-select")) {
            state[`player${playerNum}`].char = e.target.value;
            state[`player${playerNum}`].color = "";
            if (e.target.value) {
                await fetchCharColors(playerNum, e.target.value);
                const colorSelect = card.querySelector(".color-select");
                if (colorSelect.options.length > 1) { colorSelect.selectedIndex = 1; state[`player${playerNum}`].color = colorSelect.value; }
            }
        }
        if (e.target.classList.contains("color-select")) state[`player${playerNum}`].color = e.target.value;
        updateCharacterImage(playerNum);
        pushOverlayState();
        if (state[`player${playerNum}`].id !== null) {
            const saveBtn = card.querySelector(".save-player-btn");
            saveBtn.style.display = "block"; saveBtn.textContent = "🔄"; saveBtn.title = "Update Defaults";
        }
    });

    document.getElementById("player-cards-container").addEventListener("click", async (e) => {
        if (e.target.classList.contains("card-title")) enableNameEdit(e.target.dataset.player);
        if (e.target.classList.contains("save-player-btn")) await savePlayer(e.target.dataset.player);
        if (e.target.classList.contains("winner-btn")) await updateScore(e.target.dataset.player, 1);
    });

    document.getElementById("start-set-btn").addEventListener("click", startSet);
    document.getElementById("end-set-btn").addEventListener("click", endSet);
});