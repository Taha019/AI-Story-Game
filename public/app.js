const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(`${socketProtocol}//${window.location.host}`);
let pendingSocketMessage = null;
const MAX_TIMER_DURATION_SECONDS = 1800;

let roomCode = null;
let playerName = null;
let isHost = false;
let isSharedDevice = false;
let judgingMetrics = [];

// DOM Elements
const createBtn = document.getElementById('btn-create');
const joinBtn = document.getElementById('btn-join');
const startBtn = document.getElementById('btn-start');
const playerNameInput = document.getElementById('player-name');
const playModeInput = document.getElementById('play-mode');
const playerNameLabel = document.getElementById('player-name-label');
const sharedPlayerNamesGroup = document.getElementById('shared-player-names-group');
const sharedPlayerNamesInput = document.getElementById('shared-player-names');
const joinCodeInput = document.getElementById('join-code');
const totalRoundsInput = document.getElementById('total-rounds');
const metricsContainer = document.getElementById('metrics-container');
const addMetricBtn = document.getElementById('btn-add-metric');
const judgingMetricsList = document.getElementById('judging-metrics-list');
const genreInput = document.getElementById('genre-input');
const keywordsInput = document.getElementById('keywords-input');
const submitBtn = document.getElementById('btn-submit-story');
const nextRoundBtn = document.getElementById('btn-next-round');
const finishWritingBtn = document.getElementById('btn-finish-writing');
const finishSummaryBtn = document.getElementById('btn-finish-summary');
const connectionStatus = document.getElementById('connection-status');
const timerInput = document.getElementById('timer-duration-input');
const roomTimerInput = document.getElementById('room-timer-duration-input');
const hostRoomSettings = document.getElementById('host-room-settings');
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
    const singleDevice = playModeInput.value === 'single-device';
    const playerNames = singleDevice
      ? [playerName, ...sharedPlayerNamesInput.value.split(',').map((name) => name.trim()).filter(Boolean)]
      : undefined;
    if (singleDevice && (playerNames.length < 2 || playerNames.length > 5)) {
      return alert('Enter 1 to 4 other player names for a total of 2 to 5 players.');
    }
    if (singleDevice && new Set(playerNames.map((name) => name.toLowerCase())).size !== playerNames.length) {
      return alert('Each player needs a unique name.');
    }
    const timerDuration = Number(timerInput.value);
    if (!Number.isInteger(timerDuration) || timerDuration < 30 || timerDuration > MAX_TIMER_DURATION_SECONDS) {
      return alert(`Timer must be between 30 and ${MAX_TIMER_DURATION_SECONDS} seconds.`);
    }
    const metrics = collectMetrics();
    if (!metrics) return;

    sendSocketMessage({
      type: 'CREATE_ROOM',
      playerName,
      totalRounds: Number(totalRoundsInput.value),
      timerDuration,
      genre: genreInput.value.trim(),
      keywords: keywordsInput.value.trim(),
      singleDevice,
      playerNames,
      metrics: metrics.length ? metrics : undefined
    });
  });
}

if (playModeInput) {
  playModeInput.addEventListener('change', () => {
    const singleDevice = playModeInput.value === 'single-device';
    sharedPlayerNamesGroup.hidden = !singleDevice;
    playerNameLabel.innerText = singleDevice ? 'First Player Name' : 'Your Display Name';
    playerNameInput.placeholder = singleDevice ? 'Enter the first player name' : 'Enter your display name';
  });
}

if (addMetricBtn) {
  addMetricBtn.addEventListener('click', () => {
    if (metricsContainer.querySelectorAll('.metric-row').length >= 4) return;

    const row = document.createElement('div');
    row.className = 'metric-row';
    row.innerHTML = '<input type="text" class="metric-name" placeholder="Metric Name"><input type="text" class="metric-desc" placeholder="Description">';
    metricsContainer.appendChild(row);
    if (metricsContainer.querySelectorAll('.metric-row').length >= 4) {
      addMetricBtn.disabled = true;
      addMetricBtn.innerText = 'Maximum of 4 criteria';
    }
  });
}

function collectMetrics() {
  const rows = [...metricsContainer.querySelectorAll('.metric-row')];
  const metrics = rows.map((row) => ({
    name: row.querySelector('.metric-name').value.trim(),
    description: row.querySelector('.metric-desc').value.trim()
  }));
  const customMetrics = metrics.filter((metric) => metric.name || metric.description);
  if (customMetrics.length > 4) {
    alert('Add no more than 4 custom judging criteria.');
    return null;
  }
  if (customMetrics.some((metric) => !metric.name || !metric.description)) {
    alert('Enter both a name and description for every judging criterion.');
    return null;
  }
  if (new Set(customMetrics.map((metric) => metric.name.toLowerCase())).size !== customMetrics.length) {
    alert('Judging criterion names must be unique.');
    return null;
  }
  return customMetrics;
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

if (roomTimerInput) {
  roomTimerInput.addEventListener('change', (event) => {
    if (!isHost || !roomCode) return;
    const timerDuration = Number(event.target.value);
    if (!Number.isInteger(timerDuration) || timerDuration < 30 || timerDuration > MAX_TIMER_DURATION_SECONDS) {
      alert(`Timer must be between 30 and ${MAX_TIMER_DURATION_SECONDS} seconds.`);
      event.target.value = timerInput.value;
      return;
    }
    sendSocketMessage({ type: 'UPDATE_ROOM_SETTINGS', timerDuration });
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
      isSharedDevice = data.singleDevice === true;
      renderCriteria(data.metrics);
      updateLobby(data.players, data.timerDuration);
      if (hostRoomSettings) hostRoomSettings.style.display = '';
      showWaitingRoom();
      if (startBtn) startBtn.style.display = '';
      break;

    case 'ROOM_JOINED':
      roomCode = data.roomCode;
      isHost = false;
      isSharedDevice = false;
      renderCriteria(data.metrics);
      updateLobby(data.players, data.timerDuration);
      if (hostRoomSettings) hostRoomSettings.style.display = 'none';
      showWaitingRoom();
      break;

    case 'PLAYER_JOINED':
      renderCriteria(data.metrics);
      updateLobby(data.players, data.timerDuration);
      break;

    case 'ROOM_SETTINGS_UPDATED':
      if (timerDisplay) timerDisplay.innerText = `Timer: ${data.timerDuration}s`;
      if (timerInput) timerInput.value = data.timerDuration;
      if (roomTimerInput) roomTimerInput.value = data.timerDuration;
      break;

    case 'ROUND_STARTED':
      isSharedDevice = data.singleDevice === true;
      renderCriteria(data.metrics);
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
      updateSharedTurn(data.currentPlayerName);
      showView('view-writing');
      break;

    case 'PLAYER_TURN':
      updateSharedTurn(data.currentPlayerName);
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
      document.getElementById('shared-turn-banner').hidden = true;
      storyInput.disabled = true;
      submitBtn.disabled = true;
      showView('view-judging');
      break;

    case 'ROUND_RESULTS':
      renderResults(data.evaluations);
      renderStoryReview(data.stories || [], 'round-story-review-container');
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
      renderStoryReview(data.stories || data.storyHistory || [], 'final-story-review-container');
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

function updateSharedTurn(currentPlayerName) {
  const turnBanner = document.getElementById('shared-turn-banner');
  if (!turnBanner) return;
  turnBanner.hidden = !isSharedDevice;
  if (!isSharedDevice) return;
  turnBanner.innerText = `${currentPlayerName}'s turn. Pass the device, then start writing.`;
  storyInput.value = '';
  storyInput.disabled = false;
  submitBtn.disabled = false;
  submitBtn.innerText = 'Submit Story';
  if (timerDisplay) timerDisplay.innerText = 'Timer starting...';
}

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
  if (roomTimerInput) roomTimerInput.value = timerDuration;
}

function renderResults(evaluations) {
  if (!resultsDisplay) return;

  resultsDisplay.innerHTML = evaluations.map(e => `
    <div class="card my-2 p-3">
      <h4>${e.playerName} - Total Score: ${e.totalScore}</h4>
      <p><strong>Summary:</strong> ${e.summary}</p>
      <p><strong>Critique:</strong> ${e.critique}</p>
      <ul>
        ${Object.entries(e.scores).map(([key, value]) => {
          const name = judgingMetrics.find((metric) => metric.key === key)?.name || key;
          return `<li>${escapeHtml(name)}: ${escapeHtml(value)}/10</li>`;
        }).join('')}
      </ul>
    </div>
  `).join('');
}

function renderCriteria(metrics = []) {
  judgingMetrics = Array.isArray(metrics) ? metrics : [];
  if (!judgingMetricsList) return;
  judgingMetricsList.innerHTML = judgingMetrics
    .map((metric) => `<li><strong>${escapeHtml(metric.name)}</strong>: ${escapeHtml(metric.description)}</li>`)
    .join('');
}

function renderFinalStandings(standings) {
  const leaderboard = document.getElementById('final-leaderboard-container');
  const winnerAnnouncement = document.getElementById('winner-announcement');
  if (!leaderboard) return;
  const rankedStandings = [...(standings || [])].sort((first, second) => Number(second.totalScore) - Number(first.totalScore));
  if (winnerAnnouncement) {
    if (rankedStandings.length) {
      const topScore = Number(rankedStandings[0].totalScore) || 0;
      const winners = rankedStandings
        .filter((player) => Number(player.totalScore) === topScore)
        .map((player) => escapeHtml(player.playerName));
      winnerAnnouncement.innerText = `${winners.length > 1 ? 'Winners' : 'Winner'}: ${winners.join(', ')} (${topScore} points${winners.length > 1 ? ' each' : ''})`;
    } else {
      winnerAnnouncement.innerText = 'No winner: no scores were recorded.';
    }
  }
  leaderboard.innerHTML = rankedStandings
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

function renderStoryReview(stories = [], containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const entries = Array.isArray(stories) ? stories : [];
  container.innerHTML = entries.length
    ? entries.map((story) => `
      <article class="story-review-card">
        <h4>${escapeHtml(story.playerName)}${story.roundNumber ? ` · Round ${escapeHtml(story.roundNumber)}` : ''}</h4>
        <p>${escapeHtml(story.story || 'No story submitted.')}</p>
      </article>
    `).join('')
    : '<p>No stories to review yet.</p>';
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