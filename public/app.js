const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(`${socketProtocol}//${window.location.host}`);
let pendingSocketMessage = null;

let roomCode = null;
let playerName = null;
let isHost = false;

// DOM Elements
const createBtn = document.getElementById('btn-create');
const joinBtn = document.getElementById('btn-join');
const startBtn = document.getElementById('btn-start');
const playerNameInput = document.getElementById('player-name');
const joinCodeInput = document.getElementById('join-code');
const totalRoundsInput = document.getElementById('total-rounds');
const genreInput = document.getElementById('genre-input');
const keywordsInput = document.getElementById('keywords-input');
const submitBtn = document.getElementById('btn-submit-story');
const nextRoundBtn = document.getElementById('btn-next-round');
const finishWritingBtn = document.getElementById('btn-finish-writing');
const finishSummaryBtn = document.getElementById('btn-finish-summary');
const connectionStatus = document.getElementById('connection-status');
const timerInput = document.getElementById('timer-duration-input');
const storyInput = document.getElementById('story-input');
const timerDisplay = document.getElementById('timer');
const playerListDisplay = document.getElementById('player-list');
const promptTitleDisplay = document.getElementById('prompt-title');
const promptGenreDisplay = document.getElementById('prompt-genre');
const promptKeywordsDisplay = document.getElementById('prompt-keywords');
const promptGenreRow = document.getElementById('prompt-genre-row');
const promptKeywordsRow = document.getElementById('prompt-keywords-row');
const roundBadge = document.getElementById('round-badge');
const resultsDisplay = document.getElementById('round-results-container');

if (createBtn) {
  createBtn.addEventListener('click', () => {
    playerName = playerNameInput.value.trim();
    if (!playerName) return alert('Please enter your display name.');

    sendSocketMessage({
      type: 'CREATE_ROOM',
      playerName,
      totalRounds: Number(totalRoundsInput.value),
      timerDuration: Number(timerInput.value),
      genre: genreInput.value.trim(),
      keywords: keywordsInput.value.trim()
    });
  });
}

if (joinBtn) {
  joinBtn.addEventListener('click', () => {
    playerName = playerNameInput.value.trim();
    const joinCode = joinCodeInput.value.trim();
    if (!playerName) return alert('Please enter your display name.');
    if (!/^\d{4}$/.test(joinCode)) return alert('Please enter the 4-digit room code.');

    sendSocketMessage({ type: 'JOIN_ROOM', playerName, roomCode: joinCode });
  });
}

socket.addEventListener('open', () => {
  setConnectionStatus('Connected to game server.');
  if (pendingSocketMessage) {
    socket.send(pendingSocketMessage);
    pendingSocketMessage = null;
  }
});

socket.addEventListener('error', () => {
  setConnectionStatus('Could not connect to the game server. Refresh and try again.');
});

socket.addEventListener('close', () => {
  pendingSocketMessage = null;
  setConnectionStatus('Disconnected from the game server. Refresh to reconnect.');
});

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
    sendSocketMessage({ type: 'START_GAME' });
  });
}

if (nextRoundBtn) {
  nextRoundBtn.addEventListener('click', () => {
    if (!isHost) return;
    sendSocketMessage({ type: 'NEXT_ROUND' });
  });
}

function requestGameFinish() {
  if (!isHost || !confirm('Finish the game now and show final awards?')) return;
  [finishWritingBtn, finishSummaryBtn].forEach((button) => {
    if (button) {
      button.disabled = true;
      button.innerText = 'Finishing Game...';
    }
  });
  sendSocketMessage({ type: 'END_GAME' });
}

if (finishWritingBtn) finishWritingBtn.addEventListener('click', requestGameFinish);
if (finishSummaryBtn) finishSummaryBtn.addEventListener('click', requestGameFinish);

// Submit Written Story
if (submitBtn) {
  submitBtn.addEventListener('click', () => submitStory(false));
}

function submitStory(allowEmpty) {
  if (submitBtn.disabled) return;
  const storyText = storyInput.value.trim();
  if (!storyText && !allowEmpty) return alert('Please write a story before submitting!');

  sendSocketMessage({
    type: 'SUBMIT_STORY',
    story: storyText
  });

  submitBtn.disabled = true;
  storyInput.disabled = true;
  submitBtn.innerText = allowEmpty ? 'Time is up - submitted' : 'Submitted! Waiting for others...';
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
      storyInput.disabled = false;
      storyInput.value = '';
      submitBtn.disabled = false;
      submitBtn.innerText = 'Submit Story';
      promptTitleDisplay.innerText = data.prompt.title;
      promptGenreDisplay.innerText = data.prompt.genre || '';
      promptKeywordsDisplay.innerText = (data.prompt.keywords || []).join(', ');
      promptGenreRow.hidden = !data.prompt.genre;
      promptKeywordsRow.hidden = !data.prompt.keywords?.length;
      if (roundBadge) roundBadge.innerText = `Round ${data.roundNumber}`;
      if (finishWritingBtn) finishWritingBtn.style.display = isHost ? '' : 'none';
      if (timerDisplay) timerDisplay.innerText = `${Math.floor(data.duration / 60)}:${String(data.duration % 60).padStart(2, '0')}`;
      showView('view-writing');
      break;

    case 'TIMER_TICK':
      if (timerDisplay) timerDisplay.innerText = `Time Remaining: ${data.timeRemaining}s`;
      break;

    case 'ROUND_TIME_UP':
      if (timerDisplay) timerDisplay.innerText = 'Time is up';
      submitStory(true);
      break;

    case 'PLAYER_SUBMITTED':
      console.log(`${data.playerName} submitted! (${data.submittedCount}/${data.totalPlayers})`);
      break;

    case 'ROUND_JUDGING':
      storyInput.disabled = true;
      submitBtn.disabled = true;
      showView('view-judging');
      break;

    case 'ROUND_RESULTS':
      renderResults(data.evaluations);
      document.getElementById('summary-round-title').innerText = `Round ${data.roundNumber} of ${data.totalRounds}`;
      if (nextRoundBtn) {
        nextRoundBtn.style.display = isHost ? '' : 'none';
        nextRoundBtn.innerText = data.roundNumber < data.totalRounds ? 'Next Round' : 'View Final Results';
      }
      if (finishSummaryBtn) finishSummaryBtn.style.display = isHost ? '' : 'none';
      showView('view-round-summary');
      break;

    case 'GAME_OVER':
      renderFinalStandings(data.standings);
      renderAwardReport(data.awards, data.playerTraits, data.reportError);
      showView('view-final-results');
      break;

    case 'GAME_END_PENDING':
      setFinishButtonsDisabled(true, 'Finishing Game...');
      break;

    case 'ERROR':
      setFinishButtonsDisabled(false, 'Finish Game Now');
      alert(`Error: ${data.message}`);
      break;
  }
};

function showWaitingRoom() {
  document.getElementById('display-room-code').innerText = roomCode;
  showView('view-waiting');
}

function showView(viewId) {
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
}

function sendSocketMessage(message) {
  const serializedMessage = JSON.stringify(message);
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(serializedMessage);
  } else if (socket.readyState === WebSocket.CONNECTING) {
    pendingSocketMessage = serializedMessage;
    setConnectionStatus('Connecting to the game server. Your request will be sent when connected.');
  } else {
    setConnectionStatus('Not connected to the game server. Refresh to reconnect.');
  }
}

function setConnectionStatus(message) {
  if (connectionStatus) connectionStatus.innerText = message;
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

function renderFinalStandings(standings) {
  const leaderboard = document.getElementById('final-leaderboard-container');
  if (!leaderboard) return;
  leaderboard.innerHTML = standings
    .map((player, index) => `<p>${index + 1}. ${escapeHtml(player.playerName)}: ${escapeHtml(player.totalScore)}</p>`)
    .join('');
}

function setFinishButtonsDisabled(disabled, label) {
  [finishWritingBtn, finishSummaryBtn].forEach((button) => {
    if (!button) return;
    button.disabled = disabled;
    button.innerText = label;
  });
}

function renderAwardReport(awards = [], playerTraits = [], reportError = '') {
  const awardsDisplay = document.getElementById('awards-container');
  const traitsDisplay = document.getElementById('player-traits-container');
  if (awardsDisplay) {
    awardsDisplay.innerHTML = awards.length
      ? awards.map((award) => {
        const roundLabel = award.roundNumber ? ` (Round ${escapeHtml(award.roundNumber)})` : '';
        return `<article><h3>${escapeHtml(award.title)}: ${escapeHtml(award.playerName)}${roundLabel}</h3><p>${escapeHtml(award.reason)}</p></article>`;
      }).join('')
      : `<p>${escapeHtml(reportError || 'Story awards could not be generated for this game.')}</p>`;
  }
  if (traitsDisplay) {
    traitsDisplay.innerHTML = playerTraits.length
      ? playerTraits.map((entry) => `<article><h4>${escapeHtml(entry.playerName)}</h4><p>${(entry.traits || []).map(escapeHtml).join(', ')}</p><p>${escapeHtml(entry.evidence)}</p></article>`).join('')
      : `<p>${escapeHtml(reportError || 'Player traits are unavailable for this game.')}</p>`;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}