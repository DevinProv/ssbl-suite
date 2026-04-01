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

async function fetchEvents(){
    const response = await fetch("/events");
    const events = await response.json();
    const eventSelect = document.getElementById("event-select");
    eventSelect.innerHTML = "<option value=''>Select Event</option>";
    events.forEach(event => {
        const option = document.createElement("option");
        option.value = event.id;
        option.textContent = event.name;
        eventSelect.appendChild(option);
    });
    if(events.length > 0){
        state.eventID = events[0].id;
    }
}
// Autocomplete Handling
document.getElementById("player-cards-container").addEventListener("input", async (e) => {
    if (!e.target.classList.contains("player-input")) return
    const playerNum = e.target.dataset.player;
    const query = e.target.value;
    if(query.length < 1) {
        clearAutoComplete(playerNum);
        return;
    }
    const response = await fetch("/players/search?q=${query}");
    const players = await response.json();
    showAutoComplete(playerNum, players);
});

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
    state[`player${playerNum}`].char = player.char;
    state[`player${playerNum}`].color = player.color;

    // Update UI
    const card = document.getElementById(`player${playerNum}-card`);
    card.querySelector(".player-input").value = player.name;
    card.querySelector(".card-title").textContent = player.name;

    clearAutoComplete(playerNum);
    if(player.defaultChar){
        fetchCharColors(playerNum, player.defaultChar);
    }

    fetchChars(playerNum);
}
// On DOM Load
document.addEventListener("DOMContentLoaded", () => {
    createPlayerCard(1);
    createPlayerCard(2);
    fetchEvents();
});
