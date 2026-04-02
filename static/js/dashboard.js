let state = {
    eventID: null,
    setID: null,
    player1: {
        id: null,
        name: "",
        char: "",
        color: "",
        score: 0
    },
    player2: {
        id: null,
        name: "",
        char: "",
        color: "",
        score: 0
    },  
    bracketRound: "",
    gameNumber: 1
}
let availableChars = [];
let suppressBlur = false;
function createPlayerCard(playerNum){
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
// Fetch Data
async function fetchEvents(){
    const response = await fetch("api/events");
    const events = await response.json();
    const eventSelect = document.getElementById("event-select");
    eventSelect.innerHTML = "<option value=''>Select Event</option>";
    events.forEach(event => {
        const option = document.createElement("option");
        option.value = event.id;
        option.textContent = event.eventTitle;
        eventSelect.appendChild(option);
    });
    if(events.length > 0){
        state.eventID = events[0].id;
    }
}
async function fetchChars(){
    const response = await fetch("api/characters")
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
async function fetchCharColors(playerNum, charName){
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
    
    if(state[`player${playerNum}`].color){
        colorSelect.value = state[`player${playerNum}`].color;
    }
}

// Autocomplete Handling
function showAutoComplete(playerNum, players){
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
function clearAutoComplete(playerNum){
    const card = document.getElementById(`player${playerNum}-card`);
    card.querySelector(".autocomplete-results").innerHTML = "";
}
async function selectPlayer(playerNum, player) {
    suppressBlur = true; // prevent focusout from interfering
    
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
        if (player.defaultCharColor) {
            card.querySelector(".color-select").value = player.defaultCharColor;
        }
    }

    const saveBtn = card.querySelector(".save-player-btn");
    saveBtn.style.display = "block";
    saveBtn.textContent = "🔄";
    saveBtn.title = "Update Defaults";

    setTimeout(() => { suppressBlur = false; }, 200);
}
// Edit Name Swap
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

    if (input.value.trim()) {
        title.textContent = input.value.trim();
    }
    wrapper.style.display = "none";
    title.style.display = "block";
    if (ghost) ghost.value = "";
    clearAutoComplete(playerNum);
}
// Save/Update Player
async function savePlayer(playerNum) {
    const card = document.getElementById(`player${playerNum}-card`)
    const name = card.querySelector(".player-input").value || card.querySelector(".card-title").textContent
    const char = card.querySelector(".char-select").value
    const color = card.querySelector(".color-select").value
    const data = { name, defaultChar: char, defaultCharColor: color }

    let response
    if (state[`player${playerNum}`].id === null) {
        response = await fetch("/api/players", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        })
    } else {
        response = await fetch(`/api/players/${state[`player${playerNum}`].id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        })
    }

    const player = await response.json()
    state[`player${playerNum}`].id = player.id
    state[`player${playerNum}`].name = player.name
    state[`player${playerNum}`].char = player.defaultChar
    state[`player${playerNum}`].color = player.defaultCharColor

    card.querySelector(".card-title").textContent = player.name
    card.querySelector(".save-player-btn").style.display = "none"
    disableNameEdit(playerNum)
}

// Start/End Set
async function startSet(){
    if (!state.eventID || !state.bracketRound || !state.player1.id || !state.player2.id){
        alert("Please select an event, enter a round, and select both players before starting the set.");
        return;
    }
    const response = await fetch("/api/sets", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            eventID: state.eventID,
            bracketRound: state.bracketRound,
            player1ID: state.player1.id,
            player2ID: state.player2.id,
            //TODO: Implement VOD Integration when OBS Websocket Integration is added
            vodFilename: "",
            vodTimestampStart: null, 
            vodTimestampEnd: null,
            winnerID: null
        })
    });
    const match_set = await response.json();
    state.setID = match_set.id;
    document.getElementById("start-set-btn").style.display = "none";
    document.getElementById("end-set-btn").style.display = "block";
}
async function endSet(){
    const response = await fetch(`/api/sets/${state.setID}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            //Todo: Implement VOD Integration when OBS Websocket Integration is added
            vodTimestampEnd: null,
            winnerID: state.player1.score > state.player2.score ? state.player1.id : state.player2.id
        })
    });
    const match_set = await response.json();
    state.setID = null;
    document.getElementById("start-set-btn").style.display = "block";
    document.getElementById("end-set-btn").style.display = "none";
}
// Get Current Game Number
async function getCurrentGameNumber(){
    const response = await fetch(`/api/sets/${state.setID}/games`);
    const games = await response.json();
    return games.length + 1;
}
// Add Match to Set
async function addMatch(winnerID){
    const response = await fetch(`/api/sets/${state.setID}/games`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            setID: state.setID,
            gameNumber: await getCurrentGameNumber(),
            player1Char: state.player1.char,
            player2Char: state.player2.char,
            winnerID: winnerID,
        })
    });
}
// Update Score
async function updateScore(playerNum, delta){
    state[`player${playerNum}`].score += delta;
    await addMatch(state[`player${playerNum}`].id);
    const card = document.getElementById(`player${playerNum}-card`);
    card.querySelector(".player-score").textContent = state[`player${playerNum}`].score;
}

// Update Character Image
function updateCharacterImage(playerNum){
    const card = document.getElementById(`player${playerNum}-card`);
    const placeholder = card.querySelector(".char-image-placeholder");
    const img = card.querySelector(".char-image");
    const char = state[`player${playerNum}`].char;
    const color = state[`player${playerNum}`].color;

    if (char && color){
        img.src = `/api/characters/${char}/${color}/image`;
        placeholder.style.display = "none";
        img.style.display = "block";
    } else {
        img.src = "";
        placeholder.style.display = "flex";
        img.style.display = "none";
    }
}
// On DOM Load
document.addEventListener("DOMContentLoaded", () => {
    createPlayerCard(1);
    createPlayerCard(2);
    fetchEvents();
    fetchChars();
    // Name Autocomplete Listener
    document.getElementById("player-cards-container").addEventListener("input", async (e) => {
        if (!e.target.classList.contains("player-input")) return;
        const playerNum = e.target.dataset.player;
        const query = e.target.value.trim();
        const card = document.getElementById(`player${playerNum}-card`);
        const ghost = card.querySelector(".player-ghost");
        
        if (query.length < 1) {
            clearAutoComplete(playerNum);
            if (ghost) ghost.value = "";
            return;
        }

        const response = await fetch(`/api/players/search?q=${query}`);
        const players = await response.json();
        const exactMatch = players.find(p => p.name.toLowerCase() === query.toLowerCase());
        console.log("query: ",query, "exactMatch: ", exactMatch);
        if (exactMatch) {
            if (ghost) ghost.value = "";
            await selectPlayer(playerNum, exactMatch);
            return;
        }
        if (players.length > 0) {
            const topMatch = players[0].name;
            if (topMatch.toLowerCase().startsWith(query.toLowerCase())) {
                if (ghost) ghost.value = topMatch;
            } else {
                if (ghost) ghost.value = ""
            }
        } else {
            if (ghost) {
                ghost.value = "";
            }
        }
        showAutoComplete(playerNum, players);
        updateCharacterImage(playerNum);
        const saveBtn = card.querySelector(".save-player-btn");

        if (players.length === 0 && query.length > 0) {
            saveBtn.style.display = "block";
            saveBtn.textContent = "💾";
            saveBtn.title = "Save New Player";
        } else {
            saveBtn.style.display = "none";
        }
    });
    // Round Input Listener
    document.getElementById("round-input").addEventListener("input", (e) => {
        state.bracketRound = e.target.value;
    }); 
    // Event Select Listener
    document.getElementById("event-select").addEventListener("change", (e) => {
        state.eventID = e.target.value ? parseInt(e.target.value) : null
    });

    // Blur Player Name Listener
    document.getElementById("player-cards-container").addEventListener("focusout", (e) => {
        if (!e.target.classList.contains("player-input")) return
        if (suppressBlur) return;
        const playerNum = e.target.dataset.player
        // Small delay so autocomplete clicks register first
        setTimeout(() => disableNameEdit(playerNum), 150)
    });
    // Enter Key Player Name Listener
    document.getElementById("player-cards-container").addEventListener("keydown", (e) => {
        if (!e.target.classList.contains("player-input")) return
        if (e.key === "Enter") {
            const playerNum = e.target.dataset.player
            disableNameEdit(playerNum)
        }
    });
    // Ghost Listener
    document.getElementById("player-cards-container").addEventListener("keydown", (e) => {
        if (!e.target.classList.contains("player-input")) return;
        const playerNum = e.target.dataset.player;
        const card = document.getElementById(`player${playerNum}-card`);
        const ghost = card.querySelector(".player-ghost");

        if (e.key === "Tab" && ghost && ghost.value) {
            e.preventDefault();
            e.target.value = ghost.value; 
            ghost.value = "";
            e.target.dispatchEvent(new Event("input", { bubbles: true }));
        }

        if (e.key === "Enter") {
            disableNameEdit(playerNum);
        }

        if (e.key === "ArrowRight") {
            const cursorAtEnd = e.target.selectionStart === e.target.value.length;
            if (cursorAtEnd && ghost && ghost.value) {
                e.target.value = ghost.value;
                ghost.value = "";
                e.target.dispatchEvent(new Event("input", { bubbles: true}));
            }
        }
    });
    //Character Select Listener
    document.getElementById("player-cards-container").addEventListener("change", async (e) => {
        const playerNum = e.target.dataset.player;
        const card = document.getElementById(`player${playerNum}-card`);
        if (e.target.classList.contains("char-select")){
            state[`player${playerNum}`].char = e.target.value;
            state[`player${playerNum}`].color = "";
            if(e.target.value) {
                await fetchCharColors(playerNum, e.target.value);
                const colorSelect = card.querySelector(".color-select");
                if(colorSelect.options.length > 1){
                    colorSelect.selectedIndex = 1;
                    state[`player${playerNum}`].color = colorSelect.value;
                }
            }
        }
        if(e.target.classList.contains("color-select")){
            state[`player${playerNum}`].color = e.target.value;
        }
        updateCharacterImage(playerNum);
        if (state[`player${playerNum}`].id !== null){
            
            const saveBtn = card.querySelector(".save-player-btn");
            saveBtn.style.display = "block";
            saveBtn.textContent = "🔄";
            saveBtn.title = "Update Defaults";
        }
    });
    // Click Listeners for Player Cards
    document.getElementById("player-cards-container").addEventListener("click", async (e) => {
        if (e.target.classList.contains("card-title")) {
            const playerNum = e.target.dataset.player;
            enableNameEdit(playerNum);
        }
        if (e.target.classList.contains("save-player-btn")) {
            const playerNum = e.target.dataset.player;
            await savePlayer(playerNum);
        }
        if (e.target.classList.contains("winner-btn")) {
            const playerNum = e.target.dataset.player;
            await updateScore(playerNum, 1);
        }
    });
    // Set Control Listeners
    document.getElementById("start-set-btn").addEventListener("click", startSet);
    document.getElementById("end-set-btn").addEventListener("click", endSet);
});
