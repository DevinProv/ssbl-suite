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



document.addEventListener("DOMContentLoaded", () => {
    createPlayerCard(1);
    createPlayerCard(2);
    fetchEvents();
});
