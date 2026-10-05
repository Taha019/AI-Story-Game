let socket = null;
let roomCode = null;
let socketId = null;
let timerInterval = null;

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
}

function initSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}`);

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    switch (message.type) {
      case 'ROOM_CREATED':
      case 'ROOM_JOINED':
        roomCode = message.roomCode;
        socketId = message.socketId;
        document.getElementById('display-room-code').textContent = roomCode;
        showView('view-waiting');
        break;
      case 'ROOM_UPDATE':
        updateGameState(message.data);
        break;
      case 'ERROR':
        alert(message.message);
        break;
    }
  };
}

function updateGameState(data) {
  if (data.status === 'LOBBY') {
    const playerList = document.getElementById('player-list');
    playerList.innerHTML = data.players.map(p => `<span class="tag">👤 ${p.name}</span>`).join('');
    const isHost = data.players[0] && data.players[0].name === (document.getElementById('player-name').value || 'Host');
    document.getElementById('btn-start').style.display = (data.players.length >= 2 && isHost) ? 'block' : 'none';
  }

  if (data.status === 'WRITING') {
    showView('view-writing');
    document.getElementById('round-badge').textContent = `Round ${data.currentRound} of ${data.totalRounds}`;
    document.getElementById('prompt-title').textContent = data.prompt.title;
    document.getElementById('prompt-genre').textContent = data.prompt.genre;
    document.getElementById('prompt-keywords').textContent = data.prompt.keywords.join(', ');

    const isMyTurn = socketId === data.activePlayerId;
    document.getElementById('turn-indicator').textContent = isMyTurn ? 'Your Turn to Write!' : `${data.activePlayerName}'s Turn`;
    document.getElementById('active-writing-area').style.display = isMyTurn ? 'block' : 'none';
    document.getElementById('spectator-area').style.display = isMyTurn ? 'none' : 'block';
    document.getElementById('current-writer-name').textContent = data.activePlayerName;

    if (isMyTurn) startTimer(180);
  }

  if (data.status === 'JUDGING') {
    clearInterval(timerInterval);
    showView('view-judging');
  }

  if (data.status === 'ROUND_SUMMARY') {
    showView('view-round-summary');
    const latestRound = data.roundHistory[data.roundHistory.length - 1];
    document.getElementById('summary-round-title').textContent = `Round ${data.currentRound} (${latestRound.prompt.title})`;
    renderRoundSummary(latestRound.results);

    const isHost = data.players[0] && data.players[0].name === (document.getElementById('player-name').value || 'Host');
    const nextBtn = document.getElementById('btn-next-round');
    nextBtn.style.display = isHost ? 'block' : 'none';
    nextBtn.textContent = data.currentRound < data.totalRounds ? 'Start Next Round' : 'View Final Standings';
  }

  if (data.status === 'FINAL_RESULTS') {
    showView('view-final-results');
    renderFinalResults(data.finalLeaderboard, data.awards);
  }
}

function startTimer(seconds) {
  clearInterval(timerInterval);
  let duration = seconds;
  const timerDisplay = document.getElementById('timer');
  timerInterval = setInterval(() => {
    let m = Math.floor(duration / 60);
    let s = duration % 60;
    timerDisplay.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
    if (--duration < 0) {
      clearInterval(timerInterval);
      submitStory();
    }
  }, 1000);
}

function submitStory() {
  const story = document.getElementById('story-input').value;
  socket.send(JSON.stringify({
    type: 'SUBMIT_STORY',
    roomCode,
    story
  }));
  document.getElementById('story-input').value = '';
}

function renderRoundSummary(results) {
  const container = document.getElementById('round-results-container');
  container.innerHTML = results.map(res => {
    const scoresList = Object.entries(res.scores || {})
      .map(([key, val]) => `<div style="background: #1e293b; padding: 0.4rem; border-radius: 4px;">${key}: <strong>${val}</strong></div>`)
      .join('');

    return `
      <div class="result-card">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h3>👤 ${res.playerName}</h3>
          <span style="font-size: 1.2rem; font-weight: bold; color: var(--gold)">
            +${res.roundTotal} pts <small>(Total: ${res.cumulativeScore})</small>
          </span>
        </div>
        <p style="color: var(--text-muted); font-size: 0.9rem;"><strong>Summary:</strong> ${res.summary}</p>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 0.5rem; margin: 0.8rem 0; font-size: 0.85rem;">
          ${scoresList}
        </div>
        <p style="font-style: italic; color: #cbd5e1; font-size: 0.9rem;">"${res.critique}"</p>
      </div>
    `;
  }).join('');
}

function renderFinalResults(leaderboard, awards) {
  const awardsContainer = document.getElementById('awards-container');
  awardsContainer.innerHTML = awards.map(a => `
    <div class="award-card">
      <h3 style="margin: 0; color: var(--gold);">${a.title}: ${a.recipient}</h3>
      <p style="margin: 0.3rem 0 0 0; font-size: 0.9rem; color: #cbd5e1;">${a.desc}</p>
    </div>
  `).join('');

  const lbContainer = document.getElementById('final-leaderboard-container');
  lbContainer.innerHTML = leaderboard.map((p, rank) => `
    <div class="result-card" style="display: flex; justify-content: space-between; align-items: center;">
      <h3>#${rank + 1} ${p.name}</h3>
      <span style="font-size: 1.4rem; font-weight: bold; color: var(--gold);">${p.cumulativeScore} pts</span>
    </div>
  `).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  initSocket();

  document.getElementById('btn-add-metric').addEventListener('click', () => {
    const container = document.getElementById('metrics-container');
    if (container.children.length >= 4) return alert('Maximum 4 custom metrics allowed.');
    const div = document.createElement('div');
    div.className = 'metric-row';
    div.innerHTML = `
      <input type="text" class="metric-name" placeholder="Metric Name">
      <input type="text" class="metric-desc" placeholder="Description">
    `;
    container.appendChild(div);
  });

  document.getElementById('btn-create').addEventListener('click', () => {
    const playerName = document.getElementById('player-name').value.trim() || 'Host';
    const totalRounds = document.getElementById('total-rounds').value;

    const metrics = [];
    document.querySelectorAll('.metric-row').forEach(row => {
      const name = row.querySelector('.metric-name').value.trim();
      const desc = row.querySelector('.metric-desc').value.trim();
      if (name) {
        metrics.push({
          key: name.toLowerCase().replace(/\s+/g, '_'),
          name,
          description: desc || name
        });
      }
    });

    socket.send(JSON.stringify({
      type: 'CREATE_ROOM',
      playerName,
      totalRounds,
      metrics
    }));
  });

  document.getElementById('btn-join').addEventListener('click', () => {
    const playerName = document.getElementById('player-name').value.trim() || 'Player';
    const code = document.getElementById('join-code').value.trim();
    if (!code) return alert('Please enter a valid Lobby ID');
    socket.send(JSON.stringify({ type: 'JOIN_ROOM', roomCode: code, playerName }));
  });

  document.getElementById('btn-start').addEventListener('click', () => {
    socket.send(JSON.stringify({ type: 'START_GAME', roomCode }));
  });

  document.getElementById('btn-submit-story').addEventListener('click', submitStory);

  document.getElementById('btn-next-round').addEventListener('click', () => {
    socket.send(JSON.stringify({ type: 'NEXT_ROUND', roomCode }));
  });
});