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

function createPlayerCard(playerNum){
    const template = document.getElementById("player-card-template");
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector(".card");

    card.id = `player${playerNum}-card`;
    clone.querySelector(".card-title").textContent = `Player ${playerNum}`;

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
function selectPlayer(playerNum, player){
    state[`player${playerNum}`].id = player.id;
    state[`player${playerNum}`].name = player.name;
    state[`player${playerNum}`].char = player.defaultChar;
    state[`player${playerNum}`].color = player.defaultCharColor;

    // Update UI
    const card = document.getElementById(`player${playerNum}-card`);
    card.querySelector(".player-input").value = player.name;
    card.querySelector(".card-title").textContent = player.name;

    clearAutoComplete(playerNum);

    if(player.defaultChar){
        card.querySelector(".char-select").value = player.defaultChar;
        fetchCharColors(playerNum, player.defaultChar);
    }
}

// Save/Update Player
async function savePlayer(playerNum){
    const card = document.getElementById(`player${playerNum}-card`)
    const name = card.querySelector(".player-input").value;
    const char = card.querySelector(".char-select").value;
    const color = card.querySelector(".color-select").value;
    const data = {
        name: name,
        defaultChar: char,
        defaultCharColor: color
    };
    let response;
    if(state[`player${playerNum}`].id === null){
        response = await fetch("/api/players", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        });
    } else {
        response = await fetch(`/api/players/${state[`player${playerNum}`].id}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        });
    }

    const player = await response.json();

    state[`player${playerNum}`].id = player.id;
    state[`player${playerNum}`].name = player.name;
    state[`player${playerNum}`].char = player.defaultChar;
    state[`player${playerNum}`].color = player.defaultCharColor;

    card.querySelector(".save-player-btn").style.display = "none";
    card.querySelector(".card-title").textContent = player.name;
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
            
// On DOM Load
document.addEventListener("DOMContentLoaded", () => {
    createPlayerCard(1);
    createPlayerCard(2);
    fetchEvents();
    fetchChars();
    // Name Autocomplete Listener
    document.getElementById("player-cards-container").addEventListener("input", async (e) => {
        if (!e.target.classList.contains("player-input")) return
        const playerNum = e.target.dataset.player;
        const query = e.target.value;
        if(query.length < 1) {
            clearAutoComplete(playerNum);
            return;
        }
        const response = await fetch(`api/players/search?q=${query}`);
        const players = await response.json();
        showAutoComplete(playerNum, players);

        if(players.length === 0 && query.length > 0){
            const card = document.getElementById(`player${playerNum}-card`);
            card.querySelector(".save-player-btn").style.display = "block";
            card.querySelector(".save-player-btn").textContent = "Save Player";
        }
    });
    // Round Input Listener
    document.getElementById("round-input").addEventListener("input", (e) => {
        state.bracketRound = e.target.value;
    }); 
    // Save Player Listener
    document.getElementById("player-cards-container").addEventListener("click", async(e) => {
        if (!e.target.classList.contains("save-player-btn")) return
        const playerNum = e.target.dataset.player;
        await savePlayer(playerNum);
    });
    //Character Select Listener
    document.getElementById("player-cards-container").addEventListener("change", async (e) => {
        const playerNum = e.target.dataset.player;
        const charName = e.target.value;
        if (e.target.classList.contains("char-select")){
            state[`player${playerNum}`].char = e.target.value;
            if(e.target.value) fetchCharColors(playerNum, e.target.value);
        }
        if(e.target.classList.contains("color-select")){
            state[`player${playerNum}`].color = e.target.value;
        }
        
        if (state[`player${playerNum}`].id !== null){
            const card = document.getElementById(`player${playerNum}-card`);
            const saveBtn = card.querySelector(".save-player-btn");
            saveBtn.style.display = "block";
            saveBtn.textContent = "Update Defaults";
        }
    });
    // Game Winner Listener
    document.getElementById("player-cards-container").addEventListener("click", async (e) => {
        if (!e.target.classList.contains("winner-btn")) return
        const playerNum = e.target.dataset.player;
        await updateScore(playerNum, 1);
    });
    // Set Control Listeners
    document.getElementById("start-set-btn").addEventListener("click", startSet);
    document.getElementById("end-set-btn").addEventListener("click", endSet);
});
