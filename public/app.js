const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(`${socketProtocol}//${window.location.host}`);

let roomCode = null;
let playerName = null;
let isHost = false;

// DOM Elements
const createBtn = document.getElementById('btn-create');
const joinBtn = document.getElementById('btn-join');
const startBtn = document.getElementById('btn-start');
const playerNameInput = document.getElementById('player-name');
const joinCodeInput = document.getElementById('join-code');
const submitBtn = document.getElementById('submit-btn');
const timerInput = document.getElementById('timer-duration-input');
const storyInput = document.getElementById('story-textarea');
const timerDisplay = document.getElementById('timer-display');
const playerListDisplay = document.getElementById('player-list');
const promptDisplay = document.getElementById('prompt-display');
const resultsDisplay = document.getElementById('results-display');

if (createBtn) {
  createBtn.addEventListener('click', () => {
    playerName = playerNameInput.value.trim();
    if (!playerName) return alert('Please enter your display name.');
    if (socket.readyState !== WebSocket.OPEN) return alert('Connecting to the server. Please try again.');

    socket.send(JSON.stringify({ type: 'CREATE_ROOM', playerName }));
  });
}

if (joinBtn) {
  joinBtn.addEventListener('click', () => {
    playerName = playerNameInput.value.trim();
    const joinCode = joinCodeInput.value.trim();
    if (!playerName) return alert('Please enter your display name.');
    if (!/^\d{4}$/.test(joinCode)) return alert('Please enter the 4-digit room code.');
    if (socket.readyState !== WebSocket.OPEN) return alert('Connecting to the server. Please try again.');

    socket.send(JSON.stringify({ type: 'JOIN_ROOM', playerName, roomCode: joinCode }));
  });
}

// Update Room Timer Settings (Host Only)
if (timerInput) {
  timerInput.addEventListener('change', (e) => {
    if (!isHost || !roomCode) return;
    socket.send(JSON.stringify({
      type: 'UPDATE_ROOM_SETTINGS',
      timerDuration: parseInt(e.target.value, 10)
    }));
  });
}

// Start Simultaneous Writing Round
if (startBtn) {
  startBtn.addEventListener('click', () => {
    socket.send(JSON.stringify({ type: 'START_GAME' }));
  });
}

// Submit Written Story
if (submitBtn) {
  submitBtn.addEventListener('click', () => {
    const storyText = storyInput.value.trim();
    if (!storyText) return alert('Please write a story before submitting!');

    socket.send(JSON.stringify({
      type: 'SUBMIT_STORY',
      story: storyText
    }));

    submitBtn.disabled = true;
    storyInput.disabled = true;
    submitBtn.innerText = 'Submitted! Waiting for others...';
  });
}

// Handle Incoming WebSocket Messages
socket.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case 'ROOM_CREATED':
      roomCode = data.roomCode;
      isHost = true;
      updateLobby(data.players, data.timerDuration);
      showWaitingRoom();
      if (startBtn) startBtn.style.display = '';
      break;

    case 'ROOM_JOINED':
      roomCode = data.roomCode;
      isHost = false;
      updateLobby(data.players, data.timerDuration);
      showWaitingRoom();
      break;

    case 'PLAYER_JOINED':
      updateLobby(data.players, data.timerDuration);
      break;

    case 'ROOM_SETTINGS_UPDATED':
      if (timerDisplay) timerDisplay.innerText = `Timer: ${data.timerDuration}s`;
      if (timerInput) timerInput.value = data.timerDuration;
      break;

    case 'ROUND_STARTED':
      // Reset inputs for all players simultaneously
      storyInput.disabled = false;
      storyInput.value = '';
      submitBtn.disabled = false;
      submitBtn.innerText = 'Submit Story';

      promptDisplay.innerHTML = `
        <h3>${data.prompt.title} (${data.prompt.genre})</h3>
        <p><strong>Keywords:</strong> ${data.prompt.keywords.join(', ')}</p>
      `;
      break;

    case 'TIMER_TICK':
      if (timerDisplay) timerDisplay.innerText = `Time Remaining: ${data.timeRemaining}s`;
      break;

    case 'PLAYER_SUBMITTED':
      console.log(`${data.playerName} submitted! (${data.submittedCount}/${data.totalPlayers})`);
      break;

    case 'ROUND_JUDGING':
      storyInput.disabled = true;
      submitBtn.disabled = true;
      promptDisplay.innerHTML = `<h3>Judging in progress...</h3>`;
      break;

    case 'ROUND_RESULTS':
      renderResults(data.evaluations);
      break;

    case 'ERROR':
      alert(`Error: ${data.message}`);
      break;
  }
};

function showWaitingRoom() {
  document.getElementById('display-room-code').innerText = roomCode;
  document.getElementById('view-lobby').classList.remove('active');
  document.getElementById('view-waiting').classList.add('active');
}

function updateLobby(players, timerDuration) {
  if (playerListDisplay) {
    playerListDisplay.innerHTML = players.map(p => `<li>${p}</li>`).join('');
  }
  if (timerInput) timerInput.value = timerDuration;
}

function renderResults(evaluations) {
  if (!resultsDisplay) return;

  resultsDisplay.innerHTML = evaluations.map(e => `
    <div class="card my-2 p-3">
      <h4>${e.playerName} - Total Score: ${e.totalScore}</h4>
      <p><strong>Summary:</strong> ${e.summary}</p>
      <p><strong>Critique:</strong> ${e.critique}</p>
      <ul>
        ${Object.entries(e.scores).map(([k, v]) => `<li>${k}:${v}/10</li>`).join('')}
      </ul>
    </div>
  `).join('');
}