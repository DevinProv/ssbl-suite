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
    const response = await fetch("/events");
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
    const response = await fetch("/characters")
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
    const response = await fetch(`/characters/${charName}/colors`);
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
        fetchCharColors(playerNum, player.defaultChar);
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
        if (!e.target.classList.contains("player-input")) return
        const playerNum = e.target.dataset.player;
        const query = e.target.value;
        if(query.length < 1) {
            clearAutoComplete(playerNum);
            return;
        }
        const response = await fetch(`/players/search?q=${query}`);
        const players = await response.json();
        showAutoComplete(playerNum, players);
    });
    //Character Select Listener
    document.getElementById("player-cards-container").addEventListener("change", async (e) => {
        if (!e.target.classList.contains("char-select")) return
        const playerNum = e.target.dataset.player;
        const charName = e.target.value;
        
        state[`player${playerNum}`].char = charName;
        
        if(charName){
            fetchCharColors(playerNum, charName);
        }
    });

});
