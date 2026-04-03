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
            ? `/api/characters/${p.defaultChar}/default/image` : "";
        const charLabel = p.defaultChar
            ? p.defaultChar.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "No default";
        item.innerHTML = `
            <div class="player-avatar">
                ${avatarSrc ? `<img src="${avatarSrc}" onerror="this.parentElement.textContent='👤'">` : "👤"}
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
        renderPlayerList(allPlayers.filter(p => p.name.toLowerCase().includes(q)));
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

    // Fetch all data needed for detail panel
    const [sets, players, events] = await Promise.all([
        fetch("/api/sets").then(r => r.json()),
        fetch("/api/players").then(r => r.json()),
        fetch("/api/events").then(r => r.json()),
    ]);

    const playerMap = Object.fromEntries(players.map(p => [p.id, p]));
    const eventMap = Object.fromEntries(events.map(e => [e.id, e]));

    // Find all sets this player participated in
    const playerSets = sets.filter(s => playerIsInSet(s, player.id));

    // Compute stats
    const stats = computeStats(player.id, playerSets);

    renderDetailPanel(player, stats, playerSets, playerMap, eventMap);
}

// =====================
// Set/Player helpers
// =====================

function playerIsInSet(s, playerID) {
    if (s.mode === "singles") {
        return s.player1ID === playerID || s.player2ID === playerID;
    }
    if (s.mode === "doubles") {
        const t1 = s.team1, t2 = s.team2;
        return (t1 && (t1.player1ID === playerID || t1.player2ID === playerID)) ||
               (t2 && (t2.player1ID === playerID || t2.player2ID === playerID));
    }
    if (s.mode === "ffa") {
        return s.games.some(g => g.participants.some(p => p.playerID === playerID));
    }
    return false;
}

function computeStats(playerID, sets) {
    let wins = 0;
    let singles = 0, doubles = 0, ffa = 0;

    sets.forEach(s => {
        if (s.mode === "singles") {
            singles++;
            if (s.winnerID === playerID) wins++;
        } else if (s.mode === "doubles") {
            doubles++;
            // Find which team this player is on
            const onTeam1 = s.team1 && (s.team1.player1ID === playerID || s.team1.player2ID === playerID);
            const myTeamID = onTeam1 ? s.team1?.id : s.team2?.id;
            if (s.winnerTeamID && s.winnerTeamID === myTeamID) wins++;
        } else if (s.mode === "ffa") {
            ffa++;
            // FFA set win = player won the most games
            const scores = {};
            s.games.forEach(g => {
                g.participants.forEach(p => {
                    if (p.isWinner) scores[p.playerID] = (scores[p.playerID] || 0) + 1;
                });
            });
            const topPlayer = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
            if (topPlayer && parseInt(topPlayer[0]) === playerID) wins++;
        }
    });

    const total = sets.length;
    return {
        sets: total,
        wins,
        losses: total - wins,
        winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
        singlesCount: singles,
        doublesCount: doubles,
        ffaCount: ffa,
    };
}

// Get game score (games won) for a player or team within a set
function getSetScores(s, playerID) {
    if (s.mode === "singles") {
        let myWins = 0, oppWins = 0;
        const isP1 = s.player1ID === playerID;
        s.games.forEach(g => {
            const winner = g.participants.find(p => p.isWinner);
            if (!winner) return;
            if (winner.playerID === playerID) myWins++;
            else oppWins++;
        });
        return { mine: myWins, theirs: oppWins };
    }
    if (s.mode === "doubles") {
        const onTeam1 = s.team1 && (s.team1.player1ID === playerID || s.team1.player2ID === playerID);
        const myTeamID = onTeam1 ? s.team1?.id : s.team2?.id;
        let myWins = 0, oppWins = 0;
        s.games.forEach(g => {
            const winner = g.participants.find(p => p.isWinner);
            if (!winner) return;
            if (winner.teamID === myTeamID) myWins++;
            else oppWins++;
        });
        return { mine: myWins, theirs: oppWins };
    }
    if (s.mode === "ffa") {
        let myWins = 0;
        s.games.forEach(g => {
            const winner = g.participants.find(p => p.isWinner);
            if (winner && winner.playerID === playerID) myWins++;
        });
        return { mine: myWins, theirs: s.games.length - myWins };
    }
    return { mine: 0, theirs: 0 };
}

function didWinSet(s, playerID) {
    if (s.mode === "singles") return s.winnerID === playerID;
    if (s.mode === "doubles") {
        const onTeam1 = s.team1 && (s.team1.player1ID === playerID || s.team1.player2ID === playerID);
        const myTeamID = onTeam1 ? s.team1?.id : s.team2?.id;
        return s.winnerTeamID != null && s.winnerTeamID === myTeamID;
    }
    if (s.mode === "ffa") {
        const scores = {};
        s.games.forEach(g => g.participants.forEach(p => {
            if (p.isWinner) scores[p.playerID] = (scores[p.playerID] || 0) + 1;
        }));
        const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
        return top && parseInt(top[0]) === playerID;
    }
    return false;
}

// Get character(s) this player used in a set (most common across games)
function getPlayerCharsInSet(s, playerID) {
    const chars = [];
    s.games.forEach(g => {
        const part = g.participants.find(p => p.playerID === playerID);
        if (part?.character) chars.push(part.character);
    });
    // Return unique chars
    return [...new Set(chars)];
}

// =====================
// Detail Panel
// =====================
async function renderDetailPanel(player, stats, playerSets, playerMap, eventMap) {
    const right = document.getElementById("players-right");
    const avatarSrc = player.defaultChar && player.defaultCharColor
        ? `/api/characters/${player.defaultChar}/default/image` : "";
    const charLabel = player.defaultChar
        ? player.defaultChar.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "None";

    const charOptions = allChars.map(c =>
        `<option value="${c}" ${c === player.defaultChar ? "selected" : ""}>${c.replace(/_/g, " ").replace(/\b\w/g, x => x.toUpperCase())}</option>`
    ).join("");

    let colorOptions = "<option value=''>No color</option>";
    if (player.defaultChar) {
        const colors = await fetch(`/api/characters/${player.defaultChar}/colors`).then(r => r.json()).catch(() => []);
        colorOptions = colors.map(c =>
            `<option value="${c}" ${c === player.defaultCharColor ? "selected" : ""}>${c.replace(/\.[^/.]+$/, "").replace(/\b\w/g, x => x.toUpperCase())}</option>`
        ).join("");
    }

    // Mode breakdown badges
    const modeBadges = [
        stats.singlesCount > 0 ? `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--surface-3);color:var(--on-surface-dim)">${stats.singlesCount} Singles</span>` : "",
        stats.doublesCount > 0 ? `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--surface-3);color:var(--on-surface-dim)">${stats.doublesCount} Doubles</span>` : "",
        stats.ffaCount > 0 ? `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--surface-3);color:var(--on-surface-dim)">${stats.ffaCount} FFA</span>` : "",
    ].filter(Boolean).join(" ");

    right.innerHTML = `
        <div class="player-detail">
            <div class="player-detail-header">
                <div class="player-detail-avatar" id="detail-avatar">
                    ${avatarSrc ? `<img src="${avatarSrc}" onerror="this.parentElement.textContent='👤'">` : "👤"}
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
                        <select id="detail-color">${colorOptions}</select>
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
                ${modeBadges ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${modeBadges}</div>` : ""}
            </div>

            <div class="detail-card" id="match-history-card">
                <div class="detail-card-title">Match History</div>
                <div style="color:var(--on-surface-dim);font-size:12px">Loading...</div>
            </div>
        </div>
    `;

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

    renderMatchHistory(player, playerSets, playerMap, eventMap);
}

function updateDetailAvatar(char, color) {
    const avatar = document.getElementById("detail-avatar");
    if (char && color) {
        avatar.innerHTML = `<img src="/api/characters/${char}/default/image" onerror="this.parentElement.textContent='👤'">`;
    } else {
        avatar.textContent = "👤";
    }
}


// =====================
// Portrait helpers
// =====================


// =====================
// Match History
// =====================
function renderMatchHistory(player, sets, playerMap, eventMap) {
    const container = document.getElementById("match-history-card");
    if (!container) return;

    if (sets.length === 0) {
        container.innerHTML = `
            <div class="detail-card-title">Match History</div>
            <div style="color:var(--on-surface-dim);font-size:12px;padding:8px 0">No matches recorded.</div>
        `;
        return;
    }

    // Group by event, newest first
    const byEvent = {};
    sets.forEach(s => {
        if (!byEvent[s.eventID]) byEvent[s.eventID] = [];
        byEvent[s.eventID].push(s);
    });

    const sortedEventIDs = Object.keys(byEvent).sort((a, b) => {
        return Math.max(...byEvent[b].map(s => s.id)) - Math.max(...byEvent[a].map(s => s.id));
    });

    const sections = sortedEventIDs.map(eid => {
        const event = eventMap[eid];
        const eventSets = byEvent[eid];
        const eventWins = eventSets.filter(s => didWinSet(s, player.id)).length;
        const eventLosses = eventSets.length - eventWins;

        const rows = eventSets.map(s => renderSetRow(s, player, playerMap)).join("");

        return `
            <details class="match-event-group" open>
                <summary class="match-event-summary">
                    <span class="match-event-name">${event?.eventTitle || "Unknown Event"}</span>
                    <span style="font-size:10px;color:var(--on-surface-dim);margin-right:4px">${s_modeLabel(eventSets)}</span>
                    <span class="match-event-record ${eventWins > eventLosses ? "record-pos" : eventLosses > eventWins ? "record-neg" : ""}">
                        ${eventWins}W - ${eventLosses}L
                    </span>
                </summary>
                <div class="match-event-rows">${rows}</div>
            </details>
        `;
    }).join("");

    container.innerHTML = `
        <div class="detail-card-title">Match History</div>
        ${sections}
    `;

    // Wire delete buttons
    container.querySelectorAll(".game-delete-btn").forEach(btn => {
        btn.addEventListener("click", async e => {
            e.stopPropagation();
            const gameID = parseInt(btn.dataset.gameId);
            const setID = parseInt(btn.dataset.setId);
            if (!confirm("Delete this game? This cannot be undone.")) return;
            const res = await fetch(`/api/sets/${setID}/games/${gameID}`, { method: "DELETE" }).then(r => r.json());
            if (res.ok) {
                await selectPlayer(selectedPlayer);
                showToast("Game deleted", "success");
            }
        });
    });
}

function s_modeLabel(sets) {
    const modes = [...new Set(sets.map(s => s.mode))];
    return modes.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join("/");
}

function renderSetRow(s, player, playerMap) {
    const won = didWinSet(s, player.id);
    const scores = getSetScores(s, player.id);

    if (s.mode === "singles") {
        return renderSinglesRow(s, player, playerMap, won, scores);
    } else if (s.mode === "doubles") {
        return renderDoublesRow(s, player, playerMap, won, scores);
    } else {
        return renderFFARow(s, player, playerMap, won, scores);
    }
}

// =====================
// Singles Row
// =====================
function renderSinglesRow(s, player, playerMap, won, scores) {
    const isP1 = s.player1ID === player.id;
    const oppID = isP1 ? s.player2ID : s.player1ID;
    const opp = playerMap[oppID];

    const myChars = getPlayerCharsInSet(s, player.id);
    const oppChars = getPlayerCharsInSet(s, oppID);
    const myAvatarSrc = myChars[0] ? `/api/characters/${myChars[0]}/default/image` : "";
    const oppAvatarSrc = oppChars[0] ? `/api/characters/${oppChars[0]}/default/image` : "";

    const gameRows = s.games.map(g => {
        const myPart = g.participants.find(p => p.playerID === player.id);
        const oppPart = g.participants.find(p => p.playerID === oppID);
        const gWon = myPart?.isWinner;
        const gChar = myPart?.character;
        const gOppChar = oppPart?.character;
        const gAvatarSrc = gChar ? `/api/characters/${gChar}/default/image` : "";
        const gOppAvatarSrc = gOppChar ? `/api/characters/${gOppChar}/default/image` : "";

        return `
            <div class="game-row ${gWon ? "game-win" : "game-loss"}" data-game-id="${g.id}" data-set-id="${s.id}">
                <span class="game-outcome">${gWon ? "W" : "L"}</span>
                <div class="game-chars">
                    ${gAvatarSrc ? `<img class="match-char-avatar" src="${gAvatarSrc}" onerror="this.style.display='none'">` : ""}
                    <span class="game-vs-label">vs</span>
                    ${gOppAvatarSrc ? `<img class="match-char-avatar" src="${gOppAvatarSrc}" onerror="this.style.display='none'">` : ""}
                </div>
                <span class="game-num">Game ${g.gameNumber}</span>
                <button class="game-delete-btn" data-game-id="${g.id}" data-set-id="${s.id}" title="Delete game">🗑</button>
            </div>
        `;
    }).join("");

    return `
        <div class="match-row ${won ? "match-win" : "match-loss"}">
            <div class="match-outcome-bar"></div>
            <div class="match-round-label">${s.round || "Unknown Round"}</div>
            <div class="match-players">
                <div class="match-side ${won ? "match-side-winner" : ""}">
                    ${myAvatarSrc ? `<img class="match-char-avatar" src="${myAvatarSrc}" onerror="this.style.display='none'">` : ""}
                    <span class="match-player-name">${player.name}</span>
                    <span class="match-score">${scores.mine}</span>
                </div>
                <span class="match-vs">vs</span>
                <div class="match-side ${!won ? "match-side-winner" : ""}">
                    <span class="match-score">${scores.theirs}</span>
                    <span class="match-player-name">${opp?.name || "Unknown"}</span>
                    ${oppAvatarSrc ? `<img class="match-char-avatar" src="${oppAvatarSrc}" onerror="this.style.display='none'">` : ""}
                </div>
            </div>
            ${gameRows ? `<div class="game-rows">${gameRows}</div>` : ""}
        </div>
    `;
}

// =====================
// Doubles Row
// =====================
function renderDoublesRow(s, player, playerMap, won, scores) {
    const onTeam1 = s.team1 && (s.team1.player1ID === player.id || s.team1.player2ID === player.id);
    const myTeam = onTeam1 ? s.team1 : s.team2;
    const oppTeam = onTeam1 ? s.team2 : s.team1;

    const myPartnerID = myTeam?.player1ID === player.id ? myTeam?.player2ID : myTeam?.player1ID;
    const myPartner = playerMap[myPartnerID];

    const opp1 = playerMap[oppTeam?.player1ID];
    const opp2 = playerMap[oppTeam?.player2ID];

    const gameRows = s.games.map(g => {
        const myPart = g.participants.find(p => p.playerID === player.id);
        const gWon = myPart?.isWinner;
        const gChar = myPart?.character;
        const gAvatarSrc = gChar ? `/api/characters/${gChar}/default/image` : "";

        return `
            <div class="game-row ${gWon ? "game-win" : "game-loss"}" data-game-id="${g.id}" data-set-id="${s.id}">
                <span class="game-outcome">${gWon ? "W" : "L"}</span>
                <div class="game-chars">
                    ${gAvatarSrc ? `<img class="match-char-avatar" src="${gAvatarSrc}" onerror="this.style.display='none'">` : ""}
                    <span class="game-vs-label">Game ${g.gameNumber}</span>
                </div>
                <button class="game-delete-btn" data-game-id="${g.id}" data-set-id="${s.id}" title="Delete game">🗑</button>
            </div>
        `;
    }).join("");

    return `
        <div class="match-row ${won ? "match-win" : "match-loss"}">
            <div class="match-outcome-bar"></div>
            <div class="match-round-label">${s.round || "Unknown Round"} · <span style="color:var(--primary);font-size:10px">Doubles</span></div>
            <div class="match-players">
                <div class="match-side ${won ? "match-side-winner" : ""}">
                    <div style="display:flex;flex-direction:column;gap:2px">
                        <span class="match-player-name" style="font-weight:${won ? "600" : "400"}">${myTeam?.name || "Your Team"}</span>
                        <span style="font-size:10px;color:var(--on-surface-dim)">${player.name} / ${myPartner?.name || "?"}</span>
                    </div>
                    <span class="match-score">${scores.mine}</span>
                </div>
                <span class="match-vs">vs</span>
                <div class="match-side ${!won ? "match-side-winner" : ""}">
                    <span class="match-score">${scores.theirs}</span>
                    <div style="display:flex;flex-direction:column;gap:2px;text-align:right">
                        <span class="match-player-name" style="font-weight:${!won ? "600" : "400"}">${oppTeam?.name || "Opp Team"}</span>
                        <span style="font-size:10px;color:var(--on-surface-dim)">${opp1?.name || "?"} / ${opp2?.name || "?"}</span>
                    </div>
                </div>
            </div>
            ${gameRows ? `<div class="game-rows">${gameRows}</div>` : ""}
        </div>
    `;
}

// =====================
// FFA Row
// =====================
function renderFFARow(s, player, playerMap, won, scores) {
    // Get all participants in this FFA from game data
    const participantIDs = [...new Set(
        s.games.flatMap(g => g.participants.map(p => p.playerID))
    )];

    const participantNames = participantIDs
        .filter(id => id !== player.id)
        .map(id => playerMap[id]?.name || "Unknown")
        .join(", ");

    const gameRows = s.games.map(g => {
        const myPart = g.participants.find(p => p.playerID === player.id);
        const gWon = myPart?.isWinner;
        const gChar = myPart?.character;
        const gAvatarSrc = gChar ? `/api/characters/${gChar}/default/image` : "";
        const winner = g.participants.find(p => p.isWinner);
        const winnerName = winner ? (playerMap[winner.playerID]?.name || "Unknown") : "?";

        return `
            <div class="game-row ${gWon ? "game-win" : "game-loss"}" data-game-id="${g.id}" data-set-id="${s.id}">
                <span class="game-outcome">${gWon ? "W" : "L"}</span>
                <div class="game-chars">
                    ${gAvatarSrc ? `<img class="match-char-avatar" src="${gAvatarSrc}" onerror="this.style.display='none'">` : ""}
                    <span class="game-vs-label">${gWon ? "Won" : `Won by ${winnerName}`}</span>
                </div>
                <span class="game-num">Game ${g.gameNumber}</span>
                <button class="game-delete-btn" data-game-id="${g.id}" data-set-id="${s.id}" title="Delete game">🗑</button>
            </div>
        `;
    }).join("");

    return `
        <div class="match-row ${won ? "match-win" : "match-loss"}">
            <div class="match-outcome-bar"></div>
            <div class="match-round-label">${s.round || "Unknown Round"} · <span style="color:#c084fc;font-size:10px">FFA (${participantIDs.length}P)</span></div>
            <div class="match-players">
                <div class="match-side ${won ? "match-side-winner" : ""}">
                    <span class="match-player-name">${player.name}</span>
                    <span class="match-score">${scores.mine}</span>
                </div>
                <span class="match-vs">vs</span>
                <div class="match-side">
                    <span class="match-player-name" style="font-size:11px;color:var(--on-surface-dim)">${participantNames}</span>
                </div>
            </div>
            ${gameRows ? `<div class="game-rows">${gameRows}</div>` : ""}
        </div>
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
                            <select id="new-player-color"><option value="">No color</option></select>
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
        toast.style.cssText = `position:fixed;bottom:24px;right:24px;background:var(--surface-3);border:1px solid var(--outline);color:var(--on-surface);padding:10px 16px;border-radius:8px;font-size:12px;font-weight:500;opacity:0;transform:translateY(8px);transition:opacity 0.2s,transform 0.2s;pointer-events:none;z-index:9999;`;
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