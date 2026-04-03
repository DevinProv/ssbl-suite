let allPlayers = [];
let allChars = [];
let selectedPlayer = null;

// =====================
// Init
// =====================
async function init() {
    await Promise.all([fetchPlayers(), fetchChars()]);
    setupSearch();
    setupAddPlayer();
}

async function fetchPlayers() {
    allPlayers = await fetch("/api/players").then(r => r.json());
    renderPlayerList(allPlayers);
}

async function fetchChars() {
    allChars = await fetch("/api/characters").then(r => r.json());
}

function getSetScores(set, player1ID, player2ID) {
    const p1wins = set.games.filter(g => g.winnerID === player1ID).length;
    const p2wins = set.games.filter(g => g.winnerID === player2ID).length;
    return { p1: p1wins, p2: p2wins };
}
// =====================
// Player List
// =====================
function renderPlayerList(players) {
    const list = document.getElementById("player-list");

    if (players.length === 0) {
        list.innerHTML = `<div class="player-list-empty">No players found.<br>Add one below.</div>`;
        return;
    }

    list.innerHTML = "";
    players.forEach(p => {
        const item = document.createElement("div");
        item.className = `player-list-item${selectedPlayer && selectedPlayer.id === p.id ? " active" : ""}`;
        item.dataset.id = p.id;

        const avatarSrc = p.defaultChar && p.defaultCharColor
            ? `/api/characters/${p.defaultChar}/${p.defaultCharColor}/image`
            : "";

        const charLabel = p.defaultChar
            ? p.defaultChar.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
            : "No default";

        item.innerHTML = `
            <div class="player-avatar">
                ${avatarSrc
                    ? `<img src="${avatarSrc}" onerror="this.parentElement.textContent='👤'">`
                    : "👤"}
            </div>
            <div class="player-list-info">
                <div class="player-list-name">${p.name}</div>
                <div class="player-list-char">${charLabel}</div>
            </div>
        `;

        item.addEventListener("click", () => selectPlayer(p));
        list.appendChild(item);
    });
}

function setupSearch() {
    document.getElementById("player-search").addEventListener("input", e => {
        const q = e.target.value.toLowerCase();
        const filtered = allPlayers.filter(p => p.name.toLowerCase().includes(q));
        renderPlayerList(filtered);
    });
}

// =====================
// Select Player
// =====================
async function selectPlayer(player) {
    selectedPlayer = player;
    renderPlayerList(allPlayers.filter(p => {
        const q = document.getElementById("player-search").value.toLowerCase();
        return p.name.toLowerCase().includes(q);
    }));

    // Fetch player stats
    const sets = await fetch("/api/sets").then(r => r.json());
    const [players, events] = await Promise.all([
        fetch("/api/players").then(r => r.json()),
        fetch("/api/events").then(r => r.json())
    ]);
    const playerMap = Object.fromEntries(players.map(p => [p.id, p]));
    const eventMap = Object.fromEntries(events.map(e => [e.id, e]));
    const playerSets = sets.filter(s => s.player1ID === player.id || s.player2ID === player.id);
    const wins = playerSets.filter(s => s.winnerID === player.id).length;
    const losses = playerSets.length - wins;
    const winRate = playerSets.length > 0 ? Math.round((wins / playerSets.length) * 100) : 0;

    renderMatchHistory(player, playerSets, playerMap, eventMap);
    renderDetailPanel(player, { sets: playerSets.length, wins, losses, winRate });
}

// =====================
// Detail Panel
// =====================
async function renderDetailPanel(player, stats) {
    const right = document.getElementById("players-right");

    const avatarSrc = player.defaultChar && player.defaultCharColor
        ? `/api/characters/${player.defaultChar}/${player.defaultCharColor}/image`
        : "";

    const charLabel = player.defaultChar
        ? player.defaultChar.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
        : "None";

    // Build char options
    const charOptions = allChars.map(c =>
        `<option value="${c}" ${c === player.defaultChar ? "selected" : ""}>${c.replace(/_/g, " ").replace(/\b\w/g, x => x.toUpperCase())}</option>`
    ).join("");

    // Build color options
    let colorOptions = "<option value=''>No color</option>";
    if (player.defaultChar) {
        const colors = await fetch(`/api/characters/${player.defaultChar}/colors`).then(r => r.json()).catch(() => []);
        colorOptions = colors.map(c =>
            `<option value="${c}" ${c === player.defaultCharColor ? "selected" : ""}>${c.replace(/\.[^/.]+$/, "").replace(/\b\w/g, x => x.toUpperCase())}</option>`
        ).join("");
    }

    right.innerHTML = `
        <div class="player-detail">
            <div class="player-detail-header">
                <div class="player-detail-avatar" id="detail-avatar">
                    ${avatarSrc
                        ? `<img src="${avatarSrc}" onerror="this.parentElement.textContent='👤'">`
                        : "👤"}
                </div>
                <div class="player-detail-title">
                    <div class="player-detail-name">${player.name}</div>
                    <div class="player-detail-id">ID #${player.id} · ${charLabel}</div>
                </div>
                <div class="player-detail-actions">
                    <button class="btn-primary" id="save-player-btn">Save</button>
                    <button class="btn-danger" id="delete-player-btn">Delete</button>
                </div>
            </div>

            <div class="detail-card">
                <div class="detail-card-title">Character Defaults</div>
                <div class="detail-row">
                    <div class="detail-field">
                        <label>Main Character</label>
                        <select id="detail-char">
                            <option value="">No default</option>
                            ${charOptions}
                        </select>
                    </div>
                    <div class="detail-field">
                        <label>Default Color</label>
                        <select id="detail-color">
                            ${colorOptions}
                        </select>
                    </div>
                </div>
            </div>

            <div class="detail-card">
                <div class="detail-card-title">Tournament Stats</div>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-value">${stats.sets}</div>
                        <div class="stat-label">Sets Played</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">${stats.wins}</div>
                        <div class="stat-label">Sets Won</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">${stats.losses}</div>
                        <div class="stat-label">Sets Lost</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">${stats.winRate}%</div>
                        <div class="stat-label">Win Rate</div>
                    </div>
                </div>
                <div class="detail-card" id="match-history-card">
                    <div class="detail-card-title">Match History</div>
                    <div style="color:var(--on-surface-dim);font-size:12px">No matches recorded.</div>
                </div>
            </div>
        </div>
    `;

    // Char change — reload colors
    document.getElementById("detail-char").addEventListener("change", async e => {
        const char = e.target.value;
        const colorSel = document.getElementById("detail-color");
        colorSel.innerHTML = "<option value=''>No color</option>";
        if (char) {
            const colors = await fetch(`/api/characters/${char}/colors`).then(r => r.json()).catch(() => []);
            colors.forEach(c => {
                const opt = document.createElement("option");
                opt.value = c;
                opt.textContent = c.replace(/\.[^/.]+$/, "").replace(/\b\w/g, x => x.toUpperCase());
                colorSel.appendChild(opt);
            });
            if (colors.length > 0) colorSel.selectedIndex = 1;
        }
        updateDetailAvatar(char, colorSel.value);
    });

    document.getElementById("detail-color").addEventListener("change", e => {
        updateDetailAvatar(document.getElementById("detail-char").value, e.target.value);
    });

    document.getElementById("save-player-btn").addEventListener("click", () => savePlayer(player.id));
    document.getElementById("delete-player-btn").addEventListener("click", () => confirmDelete(player));
}

function updateDetailAvatar(char, color) {
    const avatar = document.getElementById("detail-avatar");
    if (char && color) {
        avatar.innerHTML = `<img src="/api/characters/${char}/${color}/image" onerror="this.parentElement.textContent='👤'">`;
    } else {
        avatar.textContent = "👤";
    }
}
// =====================
// Match History
// =====================
function renderMatchHistory(player, sets, playerMap, eventMap) {
    if (sets.length === 0) return;

    const container = document.getElementById("match-history-card");
    if (!container) return;

    const rows = sets.map(s => {
        const isP1 = s.player1ID === player.id;
        const opponent = playerMap[isP1 ? s.player2ID : s.player1ID];
        const scores = getSetScores(s, s.player1ID, s.player2ID);
        const myScore = isP1 ? scores.p1 : scores.p2;
        const oppScore = isP1 ? scores.p2 : scores.p1;
        const won = s.winnerID === player.id;
        const event = eventMap[s.eventID];

        // Get chars from games
        const myChars = [...new Set(s.games.map(g => isP1 ? g.player1Char : g.player2Char).filter(Boolean))];
        const oppChars = [...new Set(s.games.map(g => isP1 ? g.player2Char : g.player1Char).filter(Boolean))];

        const myAvatarSrc = myChars[0] && player.defaultCharColor
            ? `/api/characters/${myChars[0]}/${player.defaultCharColor}/image` : "";
        const oppAvatarSrc = oppChars[0] && opponent?.defaultCharColor
            ? `/api/characters/${oppChars[0]}/${opponent.defaultCharColor}/image` : "";

        return `
            <div class="match-row ${won ? "match-win" : "match-loss"}">
                <div class="match-outcome-bar"></div>
                <div class="match-meta">
                    <span class="match-event">${event?.eventTitle || "Unknown Event"}</span>
                    <span class="match-round">${s.bracketRound || ""}</span>
                </div>
                <div class="match-players">
                    <div class="match-side ${won ? "match-side-winner" : ""}">
                        ${myAvatarSrc ? `<img class="match-char-avatar" src="${myAvatarSrc}" onerror="this.style.display='none'">` : ""}
                        <span class="match-player-name">${player.name}</span>
                        <span class="match-score">${myScore ?? "?"}</span>
                    </div>
                    <span class="match-vs">vs</span>
                    <div class="match-side ${!won ? "match-side-winner" : ""}">
                        <span class="match-score">${oppScore ?? "?"}</span>
                        <span class="match-player-name">${opponent?.name || "Unknown"}</span>
                        ${oppAvatarSrc ? `<img class="match-char-avatar" src="${oppAvatarSrc}" onerror="this.style.display='none'">` : ""}
                    </div>
                </div>
            </div>
        `;
    }).join("");

    container.innerHTML = `
        <div class="detail-card-title">Match History</div>
        ${rows}
    `;
}
// =====================
// Save Player
// =====================
async function savePlayer(id) {
    const char = document.getElementById("detail-char").value;
    const color = document.getElementById("detail-color").value;

    await fetch(`/api/players/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultChar: char, defaultCharColor: color })
    });

    // Update local state
    const idx = allPlayers.findIndex(p => p.id === id);
    if (idx !== -1) {
        allPlayers[idx].defaultChar = char;
        allPlayers[idx].defaultCharColor = color;
        selectedPlayer = allPlayers[idx];
    }

    renderPlayerList(allPlayers);
    showToast("Player saved", "success");
}

// =====================
// Delete Player
// =====================
function confirmDelete(player) {
    const right = document.getElementById("players-right");
    const existing = right.querySelector(".delete-confirm");
    if (existing) { existing.remove(); return; }

    const confirm = document.createElement("div");
    confirm.className = "delete-confirm";
    confirm.innerHTML = `
        ⚠ Delete <strong>${player.name}</strong>? This cannot be undone.
        <button class="btn-danger" id="confirm-delete-btn" style="margin-left:auto;white-space:nowrap">Confirm Delete</button>
    `;
    right.querySelector(".player-detail").appendChild(confirm);

    document.getElementById("confirm-delete-btn").addEventListener("click", async () => {
        await fetch(`/api/players/${player.id}`, { method: "DELETE" });
        allPlayers = allPlayers.filter(p => p.id !== player.id);
        selectedPlayer = null;
        renderPlayerList(allPlayers);
        document.getElementById("players-right").innerHTML = `
            <div class="player-placeholder">
                <div class="player-placeholder-icon">👤</div>
                <p>Select a player to view details</p>
            </div>`;
        showToast("Player deleted", "success");
    });
}

// =====================
// Add New Player
// =====================
function setupAddPlayer() {
    document.getElementById("add-player-btn").addEventListener("click", () => {
        selectedPlayer = null;
        renderPlayerList(allPlayers);

        const charOptions = allChars.map(c =>
            `<option value="${c}">${c.replace(/_/g, " ").replace(/\b\w/g, x => x.toUpperCase())}</option>`
        ).join("");

        const right = document.getElementById("players-right");
        right.innerHTML = `
            <div class="player-detail new-player-form">
                <div class="player-detail-header">
                    <div class="player-detail-avatar">👤</div>
                    <div class="player-detail-title">
                        <div class="player-detail-name">New Player</div>
                        <div class="player-detail-id">Fill in details below</div>
                    </div>
                </div>

                <div class="detail-card">
                    <div class="detail-card-title">Player Info</div>
                    <div class="detail-field">
                        <label>Player Name</label>
                        <input type="text" id="new-player-name" placeholder="Enter name...">
                    </div>
                </div>

                <div class="detail-card">
                    <div class="detail-card-title">Character Defaults</div>
                    <div class="detail-row">
                        <div class="detail-field">
                            <label>Main Character</label>
                            <select id="new-player-char">
                                <option value="">No default</option>
                                ${charOptions}
                            </select>
                        </div>
                        <div class="detail-field">
                            <label>Default Color</label>
                            <select id="new-player-color">
                                <option value="">No color</option>
                            </select>
                        </div>
                    </div>
                </div>

                <button class="btn-primary" id="create-player-btn" style="align-self:flex-start">Create Player</button>
            </div>
        `;

        document.getElementById("new-player-char").addEventListener("change", async e => {
            const char = e.target.value;
            const colorSel = document.getElementById("new-player-color");
            colorSel.innerHTML = "<option value=''>No color</option>";
            if (char) {
                const colors = await fetch(`/api/characters/${char}/colors`).then(r => r.json()).catch(() => []);
                colors.forEach(c => {
                    const opt = document.createElement("option");
                    opt.value = c;
                    opt.textContent = c.replace(/\.[^/.]+$/, "").replace(/\b\w/g, x => x.toUpperCase());
                    colorSel.appendChild(opt);
                });
                if (colors.length > 0) colorSel.selectedIndex = 1;
            }
        });

        document.getElementById("create-player-btn").addEventListener("click", async () => {
            const name = document.getElementById("new-player-name").value.trim();
            if (!name) { showToast("Name is required", "error"); return; }

            const char = document.getElementById("new-player-char").value;
            const color = document.getElementById("new-player-color").value;

            const player = await fetch("/api/players", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, defaultChar: char, defaultCharColor: color })
            }).then(r => r.json());

            allPlayers.push(player);
            allPlayers.sort((a, b) => a.name.localeCompare(b.name));
            await selectPlayer(player);
            showToast(`${name} added`, "success");
        });
    });
}

// =====================
// Toast
// =====================
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
    toast._t = setTimeout(() => { toast.style.opacity = "0"; toast.style.transform = "translateY(8px)"; }, 2500);
}

init();