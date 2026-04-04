// =====================
// State
// =====================
let state = {
    mode: "singles",          // "singles" | "doubles" | "ffa"
    ffaPlayerCount: 3,
    eventID: null,
    setID: null,
    bracketRound: "",
    gameNumber: 1,
    // singles
    player1: { id: null, name: "", char: "", color: "", score: 0 },
    player2: { id: null, name: "", char: "", color: "", score: 0 },
    // doubles
    team1: { name: "Team 1", score: 0, dbID: null,
             player1: { id: null, name: "", char: "", color: "" },
             player2: { id: null, name: "", char: "", color: "" } },
    team2: { name: "Team 2", score: 0, dbID: null,
             player1: { id: null, name: "", char: "", color: "" },
             player2: { id: null, name: "", char: "", color: "" } },
    // ffa — array of up to 4 player slots
    ffaPlayers: [
        { id: null, name: "", char: "", color: "", score: 0 },
        { id: null, name: "", char: "", color: "", score: 0 },
        { id: null, name: "", char: "", color: "", score: 0 },
        { id: null, name: "", char: "", color: "", score: 0 },
    ],
};

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
    sessionStorage.setItem("ssbl_state", JSON.stringify(state));
    const ev = allEvents.find(e => e.id === state.eventID);
    const eventTitle = ev ? ev.eventTitle : "";

    let payload;
    if (state.mode === "singles") {
        payload = {
            player1: { name: state.player1.name || "Player 1", char: state.player1.char, color: state.player1.color, score: state.player1.score },
            player2: { name: state.player2.name || "Player 2", char: state.player2.char, color: state.player2.color, score: state.player2.score },
            round: state.bracketRound || "",
            event: eventTitle,
        };
    } else if (state.mode === "doubles") {
        payload = {
            player1: { name: state.team1.name || "Team 1", char: "", color: "", score: state.team1.score },
            player2: { name: state.team2.name || "Team 2", char: "", color: "", score: state.team2.score },
            round: state.bracketRound || "",
            event: eventTitle,
        };
    } else {
        // FFA — just show first two for overlay for now
        const active = state.ffaPlayers.slice(0, state.ffaPlayerCount);
        payload = {
            player1: { name: active[0]?.name || "P1", char: active[0]?.char || "", color: active[0]?.color || "", score: active[0]?.score || 0 },
            player2: { name: active[1]?.name || "P2", char: active[1]?.char || "", color: active[1]?.color || "", score: active[1]?.score || 0 },
            round: state.bracketRound || "",
            event: eventTitle,
        };
    }

    fetch("/api/overlay/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
}

// =====================
// Mode Switching
// =====================
function setMode(mode) {
    if (state.setID) return; // lock mode during active set
    state.mode = mode;
    document.querySelectorAll(".mode-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    document.getElementById("ffa-controls").style.display = mode === "ffa" ? "flex" : "none";
    renderMatchArea();
    pushOverlayState();
}

function setFFACount(count) {
    state.ffaPlayerCount = count;
    document.querySelectorAll(".ffa-count-btn").forEach(btn => {
        btn.classList.toggle("active", parseInt(btn.dataset.count) === count);
    });
    renderMatchArea();
}

// =====================
// Match Area Rendering
// =====================
function renderMatchArea() {
    const area = document.getElementById("match-area");
    area.innerHTML = "";

    if (state.mode === "singles") {
        renderSinglesArea(area);
    } else if (state.mode === "doubles") {
        renderDoublesArea(area);
    } else {
        renderFFAArea(area);
    }
}

// =====================
// Singles
// =====================
function renderSinglesArea(area) {
    const container = document.createElement("div");
    container.id = "singles-area";
    area.appendChild(container);

    [1, 2].forEach(playerNum => {
        const card = createPlayerCard(playerNum, `player${playerNum}`);
        container.appendChild(card);
    });

    // Restore state into cards
    restoreSinglesUI();
}

function createPlayerCard(labelNum, stateKey, teamKey = null, teamPlayerKey = null) {
    const template = document.getElementById("player-card-template");
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector(".card");

    const cardID = teamKey
        ? `${teamKey}-${teamPlayerKey}-card`
        : `player${labelNum}-card`;

    card.id = cardID;
    card.querySelector(".card-title").textContent = `Player ${labelNum}`;
    card.querySelector(".card-title").dataset.cardid = cardID;

    const input = card.querySelector(".player-input");
    input.dataset.cardid = cardID;
    card.querySelector(".player-ghost").dataset.cardid = cardID;
    card.querySelector(".char-select").dataset.cardid = cardID;
    card.querySelector(".color-select").dataset.cardid = cardID;
    card.querySelector(".winner-btn").dataset.cardid = cardID;
    card.querySelector(".save-player-btn").dataset.cardid = cardID;

    // Populate char select
    const charSel = card.querySelector(".char-select");
    charSel.innerHTML = "<option value=''>Select Character</option>";
    availableChars.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c.replace(/_/g, " ").replace(/\b\w/g, x => x.toUpperCase());
        charSel.appendChild(opt);
    });

    return clone;
}

function getPlayerState(cardID) {
    // Returns the state sub-object for this card and a setter
    if (cardID === "player1-card") return state.player1;
    if (cardID === "player2-card") return state.player2;
    if (cardID === "team1-player1-card") return state.team1.player1;
    if (cardID === "team1-player2-card") return state.team1.player2;
    if (cardID === "team2-player1-card") return state.team2.player1;
    if (cardID === "team2-player2-card") return state.team2.player2;
    // FFA
    const ffaMatch = cardID.match(/^ffa-player-(\d+)-card$/);
    if (ffaMatch) return state.ffaPlayers[parseInt(ffaMatch[1])];
    return null;
}

async function restoreSinglesUI() {
    for (const [playerNum, stateKey] of [[1, "player1"], [2, "player2"]]) {
        const p = state[stateKey];
        const cardID = `player${playerNum}-card`;
        const card = document.getElementById(cardID);
        if (!card || !p.name) continue;
        card.querySelector(".card-title").textContent = p.name;
        card.querySelector(".player-input").value = p.name;
        if (p.char) {
            card.querySelector(".char-select").value = p.char;
            await fetchCharColors(cardID, p.char);
            if (p.color) card.querySelector(".color-select").value = p.color;
        }
        updateCharacterImage(cardID);
        card.querySelector(".player-score").textContent = p.score;
    }
}

// =====================
// Doubles
// =====================
function renderDoublesArea(area) {
    const container = document.createElement("div");
    container.id = "doubles-area";
    area.appendChild(container);

    ["team1", "team2"].forEach((teamKey, teamIndex) => {
        const teamNum = teamIndex + 1;
        const teamData = state[teamKey];
        const block = document.createElement("div");
        block.className = "team-block";
        block.id = `${teamKey}-block`;

        // Team header
        const header = document.createElement("div");
        header.className = `team-header team-${teamNum}`;
        header.innerHTML = `
            <input type="text" class="team-name-input ${teamIndex === 1 ? "team-2" : ""}"
                   id="${teamKey}-name"
                   placeholder="Team ${teamNum} Name"
                   value="${escAttr(teamData.name)}">
            <span class="team-score-display ${teamIndex === 1 ? "team-2" : ""}" id="${teamKey}-score">
                ${teamData.score}
            </span>
        `;
        block.appendChild(header);

        // Player cards row
        const cardsRow = document.createElement("div");
        cardsRow.className = "team-cards";

        [1, 2].forEach(playerNum => {
            const playerKey = `player${playerNum}`;
            const card = createPlayerCard(playerNum, null, teamKey, playerKey);
            const cardEl = card.querySelector ? card : card.firstElementChild;

            // Add team accent class to the card div inside the fragment
            const cardDiv = Array.from(card.childNodes).find(n => n.classList?.contains("card"));
            if (cardDiv) {
                cardDiv.classList.add(`team-${teamNum}-card`);
                // Hide declare winner btn on individual cards for doubles
                const winnerBtn = cardDiv.querySelector(".winner-btn");
                if (winnerBtn) winnerBtn.style.display = "none";
            }

            cardsRow.appendChild(card);
        });

        block.appendChild(cardsRow);
        container.appendChild(block);
    });

    // Winner buttons row between teams
    const winnerRow = document.createElement("div");
    winnerRow.className = "doubles-winner-row";
    winnerRow.innerHTML = `
        <button class="doubles-winner-btn team-1-win" id="team1-wins-btn">
            ← ${state.team1.name || "Team 1"} Wins
        </button>
        <button class="doubles-winner-btn team-2-win" id="team2-wins-btn">
            ${state.team2.name || "Team 2"} Wins →
        </button>
    `;
    container.appendChild(winnerRow);

    // Wire team name inputs to update winner button labels and state
    ["team1", "team2"].forEach((teamKey, i) => {
        const input = document.getElementById(`${teamKey}-name`);
        input?.addEventListener("input", e => {
            state[teamKey].name = e.target.value;
            const btn = document.getElementById(`${teamKey}-wins-btn`);
            if (btn) {
                btn.textContent = i === 0
                    ? `← ${e.target.value || "Team 1"} Wins`
                    : `${e.target.value || "Team 2"} Wins →`;
            }
            pushOverlayState();
        });
    });

    // Wire winner buttons
    document.getElementById("team1-wins-btn")?.addEventListener("click", () => updateDoublesScore("team1"));
    document.getElementById("team2-wins-btn")?.addEventListener("click", () => updateDoublesScore("team2"));

    restoreDoublesUI();
}

async function restoreDoublesUI() {
    for (const teamKey of ["team1", "team2"]) {
        for (const playerKey of ["player1", "player2"]) {
            const p = state[teamKey][playerKey];
            const cardID = `${teamKey}-${playerKey}-card`;
            const card = document.getElementById(cardID);
            if (!card || !p.name) continue;
            card.querySelector(".card-title").textContent = p.name;
            card.querySelector(".player-input").value = p.name;
            if (p.char) {
                card.querySelector(".char-select").value = p.char;
                await fetchCharColors(cardID, p.char);
                if (p.color) card.querySelector(".color-select").value = p.color;
            }
            updateCharacterImage(cardID);
        }
    }
}

// =====================
// FFA
// =====================
function renderFFAArea(area) {
    const container = document.createElement("div");
    container.id = "ffa-area";
    area.appendChild(container);

    const cardsRow = document.createElement("div");
    cardsRow.id = "ffa-cards";
    container.appendChild(cardsRow);

    for (let i = 0; i < state.ffaPlayerCount; i++) {
        const card = createPlayerCard(i + 1, null, null, null);
        const cardDiv = Array.from(card.childNodes).find(n => n.classList?.contains("card"));
        if (cardDiv) {
            const cardID = `ffa-player-${i}-card`;
            cardDiv.id = cardID;
            cardDiv.classList.add(`ffa-card-${i}`);
            // Wire each card's winner btn individually
            const winnerBtn = cardDiv.querySelector(".winner-btn");
            if (winnerBtn) {
                winnerBtn.dataset.cardid = cardID;
                winnerBtn.textContent = "Declare Winner";
            }
            // Fix data attributes on children
            cardDiv.querySelector(".card-title").dataset.cardid = cardID;
            cardDiv.querySelector(".player-input").dataset.cardid = cardID;
            cardDiv.querySelector(".player-ghost").dataset.cardid = cardID;
            cardDiv.querySelector(".char-select").dataset.cardid = cardID;
            cardDiv.querySelector(".color-select").dataset.cardid = cardID;
            cardDiv.querySelector(".save-player-btn").dataset.cardid = cardID;
        }
        cardsRow.appendChild(card);
    }

    restoreFFAUI();
}

async function restoreFFAUI() {
    for (let i = 0; i < state.ffaPlayerCount; i++) {
        const p = state.ffaPlayers[i];
        const cardID = `ffa-player-${i}-card`;
        const card = document.getElementById(cardID);
        if (!card || !p.name) continue;
        card.querySelector(".card-title").textContent = p.name;
        card.querySelector(".player-input").value = p.name;
        if (p.char) {
            card.querySelector(".char-select").value = p.char;
            await fetchCharColors(cardID, p.char);
            if (p.color) card.querySelector(".color-select").value = p.color;
        }
        updateCharacterImage(cardID);
        card.querySelector(".player-score").textContent = p.score;
    }
}

// =====================
// Characters
// =====================
async function fetchChars() {
    const response = await fetch("/api/characters");
    availableChars = await response.json();
}

async function fetchCharColors(cardID, charName) {
    const response = await fetch(`/api/characters/${charName}/colors`);
    const colors = await response.json();
    const card = document.getElementById(cardID);
    if (!card) return;
    const colorSelect = card.querySelector(".color-select");
    colorSelect.innerHTML = "<option value=''>Select Color</option>";
    colors.forEach(color => {
        const option = document.createElement("option");
        option.value = color;
        option.textContent = color.replace(/\.[^/.]+$/, "").replace(/\b\w/g, c => c.toUpperCase());
        colorSelect.appendChild(option);
    });
    const p = getPlayerState(cardID);
    if (p?.color) colorSelect.value = p.color;
}

function updateCharacterImage(cardID) {
    const card = document.getElementById(cardID);
    if (!card) return;
    const p = getPlayerState(cardID);
    if (!p) return;
    const placeholder = card.querySelector(".char-image-placeholder");
    const img = card.querySelector(".char-image");
    if (p.char && p.color) {
        img.src = `/api/characters/${p.char}/${p.color}/image`;
        placeholder.style.display = "none";
        img.style.display = "block";
    } else {
        img.src = "";
        placeholder.style.display = "flex";
        img.style.display = "none";
    }
}

// =====================
// Autocomplete
// =====================
function showAutoComplete(cardID, players) {
    const card = document.getElementById(cardID);
    if (!card) return;
    const results = card.querySelector(".autocomplete-results");
    results.innerHTML = "";
    players.forEach(player => {
        const item = document.createElement("div");
        item.className = "autocomplete-item";
        item.textContent = player.name;
        item.addEventListener("click", () => selectPlayerForCard(cardID, player));
        results.appendChild(item);
    });
}

function clearAutoComplete(cardID) {
    const card = document.getElementById(cardID);
    if (!card) return;
    card.querySelector(".autocomplete-results").innerHTML = "";
}

async function selectPlayerForCard(cardID, player) {
    suppressBlur = true;
    const p = getPlayerState(cardID);
    if (!p) return;

    p.id = player.id;
    p.name = player.name;
    p.char = player.defaultChar || "";
    p.color = player.defaultCharColor || "";

    const card = document.getElementById(cardID);
    if (!card) return;
    card.querySelector(".player-input").value = player.name;
    card.querySelector(".card-title").textContent = player.name;
    clearAutoComplete(cardID);
    disableNameEdit(cardID);

    if (player.defaultChar) {
        card.querySelector(".char-select").value = player.defaultChar;
        await fetchCharColors(cardID, player.defaultChar);
        if (player.defaultCharColor) card.querySelector(".color-select").value = player.defaultCharColor;
    }
    updateCharacterImage(cardID);

    const saveBtn = card.querySelector(".save-player-btn");
    saveBtn.style.display = "block";
    saveBtn.textContent = "🔄";
    saveBtn.title = "Update Defaults";

    pushOverlayState();
    setTimeout(() => { suppressBlur = false; }, 200);
}

function enableNameEdit(cardID) {
    const card = document.getElementById(cardID);
    if (!card) return;
    const title = card.querySelector(".card-title");
    const wrapper = card.querySelector(".player-input-wrapper");
    const input = card.querySelector(".player-input");
    const currentName = title.textContent;
    const playerNum = currentName.match(/^Player \d+$/) ? "" : currentName;
    input.value = playerNum;
    title.style.display = "none";
    wrapper.style.display = "flex";
    input.focus();
    input.select();
}

function disableNameEdit(cardID) {
    const card = document.getElementById(cardID);
    if (!card) return;
    const title = card.querySelector(".card-title");
    const wrapper = card.querySelector(".player-input-wrapper");
    const input = card.querySelector(".player-input");
    const ghost = card.querySelector(".player-ghost");
    if (input.value.trim()) title.textContent = input.value.trim();
    wrapper.style.display = "none";
    title.style.display = "block";
    if (ghost) ghost.value = "";
    clearAutoComplete(cardID);
}

async function savePlayerForCard(cardID) {
    const card = document.getElementById(cardID);
    if (!card) return;
    const p = getPlayerState(cardID);
    if (!p) return;

    const name = card.querySelector(".player-input").value || card.querySelector(".card-title").textContent;
    const char = card.querySelector(".char-select").value;
    const color = card.querySelector(".color-select").value;

    let response;
    if (!p.id) {
        response = await fetch("/api/players", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, defaultChar: char, defaultCharColor: color })
        });
    } else {
        response = await fetch(`/api/players/${p.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, defaultChar: char, defaultCharColor: color })
        });
    }
    const player = await response.json();
    p.id = player.id;
    p.name = player.name;
    p.char = player.defaultChar;
    p.color = player.defaultCharColor;

    card.querySelector(".card-title").textContent = player.name;
    card.querySelector(".save-player-btn").style.display = "none";
    disableNameEdit(cardID);
    pushOverlayState();
}

// =====================
// Score / Game Recording
// =====================
async function updateScore(cardID) {
    if (!state.setID) return;

    if (state.mode === "singles") {
        const isP1 = cardID === "player1-card";
        const winner = isP1 ? state.player1 : state.player2;
        const loser = isP1 ? state.player2 : state.player1;
        winner.score++;

        await recordGame([
            { playerID: winner.id, character: winner.char, isWinner: true },
            { playerID: loser.id, character: loser.char, isWinner: false },
        ]);

        document.getElementById(cardID).querySelector(".player-score").textContent = winner.score;
        updateUndoBtn();

    } else if (state.mode === "ffa") {
        const ffaMatch = cardID.match(/^ffa-player-(\d+)-card$/);
        if (!ffaMatch) return;
        const winnerIdx = parseInt(ffaMatch[1]);
        const winner = state.ffaPlayers[winnerIdx];
        winner.score++;

        const participants = state.ffaPlayers.slice(0, state.ffaPlayerCount).map((p, i) => ({
            playerID: p.id,
            character: p.char,
            isWinner: i === winnerIdx,
        })).filter(p => p.playerID);

        await recordGame(participants);
        document.getElementById(cardID).querySelector(".player-score").textContent = winner.score;
        updateUndoBtn();
    }

    pushOverlayState();
}

async function updateDoublesScore(winnerTeamKey) {
    if (!state.setID) return;

    const winnerTeam = state[winnerTeamKey];
    const loserTeam = winnerTeamKey === "team1" ? state.team2 : state.team1;
    winnerTeam.score++;

    const winnerTeamID = winnerTeam.dbID;
    const loserTeamID = loserTeam.dbID;

    const participants = [
        { playerID: winnerTeam.player1.id, teamID: winnerTeamID, character: winnerTeam.player1.char, isWinner: true },
        { playerID: winnerTeam.player2.id, teamID: winnerTeamID, character: winnerTeam.player2.char, isWinner: true },
        { playerID: loserTeam.player1.id, teamID: loserTeamID, character: loserTeam.player1.char, isWinner: false },
        { playerID: loserTeam.player2.id, teamID: loserTeamID, character: loserTeam.player2.char, isWinner: false },
    ].filter(p => p.playerID);

    await recordGame(participants, null, winnerTeamID);

    document.getElementById(`${winnerTeamKey}-score`).textContent = winnerTeam.score;
    updateUndoBtn();
    pushOverlayState();
}

async function recordGame(participants, winnerID = null, winnerTeamID = null) {
    const gameNum = await getCurrentGameNumber();
    await fetch(`/api/sets/${state.setID}/games`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameNumber: gameNum, participants })
    });
}

async function getCurrentGameNumber() {
    const games = await fetch(`/api/sets/${state.setID}/games`).then(r => r.json());
    return games.length + 1;
}

// =====================
// Undo
// =====================
async function undoLastGame() {
    if (!state.setID) return;
    const res = await fetch(`/api/sets/${state.setID}/games/last`, { method: "DELETE" }).then(r => r.json());
    if (!res.ok) return;

    if (state.mode === "singles") {
        for (const [key, cardID] of [["player1", "player1-card"], ["player2", "player2-card"]]) {
            if (state[key].id === res.winnerID) {
                state[key].score = Math.max(0, state[key].score - 1);
                const scoreEl = document.getElementById(cardID)?.querySelector(".player-score"); if (scoreEl) scoreEl.textContent = state[key].score;
                break;
            }
        }
    } else if (state.mode === "doubles") {
        for (const teamKey of ["team1", "team2"]) {
            if (state[teamKey].dbID === res.winnerTeamID) {
                state[teamKey].score = Math.max(0, state[teamKey].score - 1);
                document.getElementById(`${teamKey}-score`).textContent = state[teamKey].score;
                break;
            }
        }
    } else {
        // FFA — find which player won
        for (let i = 0; i < state.ffaPlayerCount; i++) {
            if (state.ffaPlayers[i].id === res.winnerID) {
                state.ffaPlayers[i].score = Math.max(0, state.ffaPlayers[i].score - 1);
                const scoreEl2 = document.getElementById(`ffa-player-${i}-card`)?.querySelector(".player-score"); if (scoreEl2) scoreEl2.textContent = state.ffaPlayers[i].score;
                break;
            }
        }
    }

    updateUndoBtn();
    pushOverlayState();
}

function updateUndoBtn() {
    const btn = document.getElementById("undo-game-btn");
    if (!btn) return;
    let hasGames = false;
    if (state.mode === "singles") {
        hasGames = state.player1.score > 0 || state.player2.score > 0;
    } else if (state.mode === "doubles") {
        hasGames = state.team1.score > 0 || state.team2.score > 0;
    } else {
        hasGames = state.ffaPlayers.some(p => p.score > 0);
    }
    btn.style.display = state.setID && hasGames ? "inline-flex" : "none";
}

// =====================
// Set Management
// =====================
async function startSet() {
    if (!state.eventID || !state.bracketRound) {
        alert("Please select an event and round before starting the set.");
        return;
    }

    if (state.mode === "singles") {
        if (!state.player1.id || !state.player2.id) {
            alert("Please select both players.");
            return;
        }
    } else if (state.mode === "doubles") {
        const allPlayersSet = state.team1.player1.id && state.team1.player2.id &&
                              state.team2.player1.id && state.team2.player2.id;
        if (!allPlayersSet) {
            alert("Please select all 4 players.");
            return;
        }
    } else {
        const activePlayers = state.ffaPlayers.slice(0, state.ffaPlayerCount);
        if (activePlayers.some(p => !p.id)) {
            alert("Please select all players.");
            return;
        }
    }

    let vodFilename = null, vodTimestampStart = null;
    const obsStatus = await fetch("/api/obs/status").then(r => r.json()).catch(() => ({ connected: false }));
    if (obsStatus.connected) {
        try {
            const [filenameRes, timestampRes] = await Promise.all([
                fetch("/api/obs/last-recording").then(r => r.ok ? r.json() : null),
                fetch("/api/obs/timestamp").then(r => r.ok ? r.json() : null)
            ]);
            vodFilename = filenameRes?.filename ?? null;
            vodTimestampStart = timestampRes?.duration ?? null;
        } catch (e) {
            console.warn("[OBS] Could not get VOD info:", e);
        }
    }

    let setPayload = {
        eventID: state.eventID,
        bracketRound: state.bracketRound,
        mode: state.mode,
        vodFilename,
        vodTimestampStart,
        vodTimestampEnd: null,
    };

    if (state.mode === "singles") {
        setPayload.player1ID = state.player1.id;
        setPayload.player2ID = state.player2.id;
    } else if (state.mode === "doubles") {
        // Create teams first
        setPayload.team1 = {
            name: state.team1.name || "Team 1",
            player1ID: state.team1.player1.id,
            player2ID: state.team1.player2.id,
        };
        setPayload.team2 = {
            name: state.team2.name || "Team 2",
            player1ID: state.team2.player1.id,
            player2ID: state.team2.player2.id,
        };
    }
    // FFA: no player IDs on the set itself

    const matchSet = await fetch("/api/sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setPayload)
    }).then(r => r.json());

    state.setID = matchSet.id;

    // Store team DB IDs for doubles score tracking
    if (state.mode === "doubles" && matchSet.team1 && matchSet.team2) {
        state.team1.dbID = matchSet.team1.id;
        state.team2.dbID = matchSet.team2.id;
    }

    document.getElementById("start-set-btn").style.display = "none";
    document.getElementById("end-set-btn").style.display = "block";
    // Lock mode during set
    document.querySelectorAll(".mode-btn").forEach(btn => btn.disabled = true);
    updateUndoBtn();
    sessionStorage.setItem("ssbl_state", JSON.stringify(state));
}

async function endSet() {
    let vodTimestampEnd = null;
    const obsStatus = await fetch("/api/obs/status").then(r => r.json()).catch(() => ({ connected: false }));
    if (obsStatus.connected) {
        try {
            const timestampRes = await fetch("/api/obs/timestamp").then(r => r.ok ? r.json() : null);
            vodTimestampEnd = timestampRes?.duration != null ? timestampRes.duration + 2000 : null;
        } catch (e) {
            console.warn("[OBS] Could not get timestamp:", e);
        }
    }

    // Determine winner
    let winnerPayload = { vodTimestampEnd };
    if (state.mode === "singles") {
        winnerPayload.winnerID = state.player1.score > state.player2.score
            ? state.player1.id : state.player2.id;
    } else if (state.mode === "doubles") {
        winnerPayload.winnerTeamID = state.team1.score > state.team2.score
            ? state.team1.dbID : state.team2.dbID;
    }
    // FFA: no overall winner on the set, individual game winners tracked in GameParticipant

    await fetch(`/api/sets/${state.setID}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(winnerPayload)
    });

    // Reset scores
    state.setID = null;
    state.player1.score = 0;
    state.player2.score = 0;
    state.team1.score = 0;
    state.team2.score = 0;
    state.team1.dbID = null;
    state.team2.dbID = null;
    state.ffaPlayers.forEach(p => p.score = 0);

    document.getElementById("start-set-btn").style.display = "block";
    document.getElementById("end-set-btn").style.display = "none";
    document.querySelectorAll(".mode-btn").forEach(btn => btn.disabled = false);
    updateUndoBtn();

    // Re-render to reset scores display
    renderMatchArea();
    pushOverlayState();

    // Auto-sync to GitHub if enabled
    fetch("/api/sync/status").then(r => r.json()).then(status => {
        if (status.auto_sync) {
            fetch("/api/sync/push", { method: "POST" })
                .then(r => r.json())
                .then(res => {
                    if (res.ok) console.log("[Sync] Auto-synced to GitHub");
                    else console.warn("[Sync] Auto-sync failed:", res.error);
                })
                .catch(e => console.warn("[Sync] Auto-sync error:", e));
        }
    }).catch(() => {});
}

// =====================
// Events & Rounds (unchanged from original)
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
// Events Modal (unchanged)
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
            <button class="modal-event-delete" data-id="${e.id}">🗑</button>
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
            if (!confirm("Delete this event?")) return;
            await fetch(`/api/events/${id}`, { method: "DELETE" });
            allEvents = allEvents.filter(ev => ev.id !== id);
            if (state.eventID === id) { state.eventID = allEvents[0]?.id || null; loadRoundsForEvent(state.eventID); }
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
    grid.querySelectorAll(".template-item").forEach(item => {
        item.addEventListener("click", () => {
            grid.querySelectorAll(".template-item").forEach(i => i.style.borderColor = "");
            item.style.borderColor = "var(--primary)";
            grid._selected = allTemplates.find(t => t.id === parseInt(item.dataset.id));
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
    document.getElementById("new-event-title").value = "";
    document.getElementById("new-event-date").value = "";
    document.getElementById("new-event-bracket").value = "";
    templateGrid._selected = null;
    closeEventsModal();
}

// =====================
// Rounds Modal (unchanged)
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
function closeRoundsModal() { document.getElementById("rounds-modal-overlay").classList.remove("open"); }
function renderRoundList() {
    const list = document.getElementById("round-list");
    if (roundsModalRounds.length === 0) {
        list.innerHTML = `<div style="color:var(--on-surface-dim);font-size:12px;padding:12px">No rounds yet.</div>`;
        return;
    }
    list.innerHTML = roundsModalRounds.map((r, i) => `
        <div class="round-item" draggable="true" data-index="${i}">
            <span class="round-drag-handle">⠿</span>
            <span class="round-item-name">${r}</span>
            <button class="round-item-delete" data-index="${i}">✕</button>
        </div>
    `).join("");
    list.querySelectorAll(".round-item-delete").forEach(btn => {
        btn.addEventListener("click", () => { roundsModalRounds.splice(parseInt(btn.dataset.index), 1); renderRoundList(); });
    });
    let dragSrc = null;
    list.querySelectorAll(".round-item").forEach(item => {
        item.addEventListener("dragstart", () => { dragSrc = parseInt(item.dataset.index); item.style.opacity = "0.5"; });
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
            ${!t.is_builtin ? `<button class="template-item-delete" data-id="${t.id}">✕</button>` : ""}
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
// Helper
// =====================
function escAttr(str) {
    return (str || "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// =====================
// DOM Ready
// =====================
document.addEventListener("DOMContentLoaded", async () => {
    // Restore state
    const saved = sessionStorage.getItem("ssbl_state");
    if (saved) {
        try { Object.assign(state, JSON.parse(saved)); } catch(e) {}
    }

    await fetchChars();
    await Promise.all([fetchEvents(), fetchTemplates()]);

    // Render initial match area
    renderMatchArea();

    // Restore mode toggle UI
    document.querySelectorAll(".mode-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.mode === state.mode);
    });
    if (state.mode === "ffa") {
        document.getElementById("ffa-controls").style.display = "flex";
        document.querySelectorAll(".ffa-count-btn").forEach(btn => {
            btn.classList.toggle("active", parseInt(btn.dataset.count) === state.ffaPlayerCount);
        });
    }

    // Restore set state
    if (state.setID) {
        document.getElementById("start-set-btn").style.display = "none";
        document.getElementById("end-set-btn").style.display = "block";
        document.querySelectorAll(".mode-btn").forEach(btn => btn.disabled = true);
        updateUndoBtn();
    }

    // =====================
    // Event Listeners
    // =====================

    // Mode toggle
    document.querySelectorAll(".mode-btn").forEach(btn => {
        btn.addEventListener("click", () => setMode(btn.dataset.mode));
    });

    // FFA count
    document.querySelectorAll(".ffa-count-btn").forEach(btn => {
        btn.addEventListener("click", () => setFFACount(parseInt(btn.dataset.count)));
    });

    // Event/round selects
    document.getElementById("event-select").addEventListener("change", e => {
        state.eventID = e.target.value ? parseInt(e.target.value) : null;
        loadRoundsForEvent(state.eventID);
        state.bracketRound = "";
        pushOverlayState();
    });
    document.getElementById("round-select").addEventListener("change", e => {
        state.bracketRound = e.target.value;
        pushOverlayState();
    });

    // Edit modals
    document.getElementById("edit-events-btn").addEventListener("click", openEventsModal);
    document.getElementById("edit-rounds-btn").addEventListener("click", openRoundsModal);
    document.getElementById("events-modal-close").addEventListener("click", closeEventsModal);
    document.getElementById("events-modal-cancel").addEventListener("click", closeEventsModal);
    document.getElementById("create-event-btn").addEventListener("click", createEvent);
    document.getElementById("events-modal-overlay").addEventListener("click", e => {
        if (e.target === document.getElementById("events-modal-overlay")) closeEventsModal();
    });
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

    // Set controls
    document.getElementById("start-set-btn").addEventListener("click", startSet);
    document.getElementById("end-set-btn").addEventListener("click", endSet);
    document.getElementById("undo-game-btn").addEventListener("click", undoLastGame);

    // =====================
    // Delegated card events (match-area handles all cards)
    // =====================
    const matchArea = document.getElementById("match-area");

    // Click card title → enable name edit
    matchArea.addEventListener("click", async e => {
        const cardTitle = e.target.closest(".card-title");
        if (cardTitle) { enableNameEdit(cardTitle.dataset.cardid); return; }

        const saveBtn = e.target.closest(".save-player-btn");
        if (saveBtn) { await savePlayerForCard(saveBtn.dataset.cardid); return; }

        const winnerBtn = e.target.closest(".winner-btn");
        if (winnerBtn) { await updateScore(winnerBtn.dataset.cardid); return; }
    });

    // Autocomplete input
    matchArea.addEventListener("input", async e => {
        const input = e.target.closest(".player-input");
        if (!input) return;
        const cardID = input.dataset.cardid;
        const card = document.getElementById(cardID);
        if (!card) return;
        const ghost = card.querySelector(".player-ghost");
        const query = input.value.trim();

        if (query.length < 1) { clearAutoComplete(cardID); if (ghost) ghost.value = ""; return; }

        const players = await fetch(`/api/players/search?q=${query}`).then(r => r.json());
        const exactMatch = players.find(p => p.name.toLowerCase() === query.toLowerCase());
        if (exactMatch) { if (ghost) ghost.value = ""; await selectPlayerForCard(cardID, exactMatch); return; }

        if (players.length > 0) {
            const top = players[0].name;
            if (ghost) ghost.value = top.toLowerCase().startsWith(query.toLowerCase()) ? top : "";
        } else { if (ghost) ghost.value = ""; }

        showAutoComplete(cardID, players);

        const saveBtn = card.querySelector(".save-player-btn");
        if (players.length === 0 && query.length > 0) {
            saveBtn.style.display = "block";
            saveBtn.textContent = "💾";
            saveBtn.title = "Save New Player";
        }
    });

    // Blur → close name edit
    matchArea.addEventListener("focusout", e => {
        const input = e.target.closest(".player-input");
        if (!input || suppressBlur) return;
        setTimeout(() => disableNameEdit(input.dataset.cardid), 150);
    });

    // Keyboard shortcuts in name input
    matchArea.addEventListener("keydown", e => {
        const input = e.target.closest(".player-input");
        if (!input) return;
        const cardID = input.dataset.cardid;
        const card = document.getElementById(cardID);
        const ghost = card?.querySelector(".player-ghost");

        if (e.key === "Tab" && ghost?.value) {
            e.preventDefault();
            input.value = ghost.value;
            ghost.value = "";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (e.key === "Enter") disableNameEdit(cardID);
        if (e.key === "ArrowRight" && e.target.selectionStart === input.value.length && ghost?.value) {
            input.value = ghost.value;
            ghost.value = "";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }
    });

    // Char/color select changes
    matchArea.addEventListener("change", async e => {
        const sel = e.target.closest(".char-select, .color-select");
        if (!sel) return;
        const cardID = sel.dataset.cardid;
        const p = getPlayerState(cardID);
        if (!p) return;

        if (sel.classList.contains("char-select")) {
            p.char = sel.value;
            p.color = "";
            if (sel.value) {
                await fetchCharColors(cardID, sel.value);
                const card = document.getElementById(cardID);
                const colorSel = card?.querySelector(".color-select");
                if (colorSel?.options.length > 1) {
                    // Prefer default.png if available, otherwise first color
                    const defaultOpt = Array.from(colorSel.options).find(o => o.value === "default.png");
                    if (defaultOpt) {
                        colorSel.value = "default.png";
                    } else {
                        colorSel.selectedIndex = 1;
                    }
                    p.color = colorSel.value;
                }
            }
        } else {
            p.color = sel.value;
        }

        updateCharacterImage(cardID);
        pushOverlayState();

        // Show save button if player is known
        if (p.id) {
            const card = document.getElementById(cardID);
            const saveBtn = card?.querySelector(".save-player-btn");
            if (saveBtn) { saveBtn.style.display = "block"; saveBtn.textContent = "🔄"; saveBtn.title = "Update Defaults"; }
        }
    });
});