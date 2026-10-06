import { GeminiService } from './geminiService.js';

export class Room {
  constructor(code, hostPlayerName, options = {}) {
    this.code = code;
    this.host = hostPlayerName;
    this.singleDevice = options.singleDevice === true;
    this.players = new Map(); // playerName -> socket
    this.timerDuration = 300; // Default duration in seconds
    this.setTimerDuration(options.timerDuration);
    this.totalRounds = Number.isInteger(Number(options.totalRounds)) && Number(options.totalRounds) >= 1 && Number(options.totalRounds) <= 10
      ? Number(options.totalRounds)
      : 3;
    this.genre = typeof options.genre === 'string' ? options.genre.trim().slice(0, 80) || null : null;
    this.keywords = Array.isArray(options.keywords)
      ? options.keywords.filter((keyword) => typeof keyword === 'string' && keyword.trim()).slice(0, 8)
      : [];
    this.roundNumber = 0;
    this.promptTitles = [];
    this.scoreTotals = new Map();
    this.status = 'WAITING'; // WAITING, WRITING, JUDGING, FINISHED, GAME_OVER
    this.currentPrompt = null;
    this.submissions = new Map(); // playerName -> story text string
    this.storyHistory = [];
    this.endGameRequested = false;
    
    const defaultMetrics = [
      { key: 'Structured Chaos', name: 'Structured Chaos', description: 'Unpredictable, wild elements that follow the internal logic of the world.' },
      { key: 'Conceptual Originality', name: 'Conceptual Originality', description: 'Fresh, unexpected premises that take daring creative risks.' },
      { key: 'Atmospheric Immersion', name: 'Atmospheric Immersion', description: 'Strong sensory detail, tone, and tactile setting work.' },
      { key: 'Narrative Velocity and Flow', name: 'Narrative Velocity & Flow', description: 'Crisp pacing, readability, and momentum without narrative roadblocks.' },
      { key: 'Emotional Resonance or Comedic Landing', name: 'Emotional Resonance or Comedic Landing', description: 'A genuine intended impact, whether a hard-hitting punchline or quiet resonance.' },
      { key: 'Character Anchoring', name: 'Character Anchoring', description: 'Distinct voices, clear motivations, and memorable presence.' },
      { key: 'The Twist / Satisfying Payoff', name: 'The Twist / Satisfying Payoff', description: 'A climax or subversion that feels earned by the setup.' },
      { key: 'Prompt Fidelity', name: 'Prompt Fidelity', description: 'Deep integration of the theme into the DNA of the story.' }
    ];
    if (this.keywords.length && options.metrics === undefined) {
      defaultMetrics.push({
        key: 'keywordUsage',
        name: 'Keyword Usage',
        description: 'Seamless incorporation of the required words.'
      });
    }
    this.customMetrics = options.metrics === undefined
      ? defaultMetrics
      : normalizeMetrics(options.metrics);
    
    this.timerInterval = null;
    this.submissionTimeout = null;
    this.timeRemaining = 0;
  }

  addPlayer(playerName, socket) {
    this.players.set(playerName, socket);
  }

  removePlayer(playerName) {
    this.players.delete(playerName);
    if (this.host === playerName && this.players.size > 0) {
      this.host = Array.from(this.players.keys())[0];
    }
  }

  setTimerDuration(seconds) {
    const duration = Number(seconds);
    if (Number.isInteger(duration) && duration >= 30 && duration <= 1800) {
      this.timerDuration = duration;
      return true;
    }
    return false;
  }

  getPlayerList() {
    return Array.from(this.players.keys());
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    const sockets = new Set(this.players.values());
    for (const socket of sockets) {
      if (socket.readyState === 1) { // WebSocket.OPEN
        socket.send(payload);
      }
    }
  }
}

function normalizeMetrics(metrics) {
  if (!Array.isArray(metrics) || metrics.length < 1 || metrics.length > 4) {
    throw new Error('Choose between 1 and 4 judging criteria.');
  }

  const names = new Set();
  const keys = new Set();
  return metrics.map((metric, index) => {
    const name = typeof metric.name === 'string' ? metric.name.trim().slice(0, 50) : '';
    const description = typeof metric.description === 'string' ? metric.description.trim().slice(0, 250) : '';
    const normalizedName = name.toLowerCase();
    if (!name || !description) throw new Error('Each judging criterion needs a name and description.');
    if (names.has(normalizedName)) throw new Error('Judging criterion names must be unique.');
    names.add(normalizedName);

    const baseKey = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `metric_${index + 1}`;
    let key = baseKey;
    let suffix = 2;
    while (keys.has(key)) key = `${baseKey}_${suffix++}`;
    keys.add(key);
    return { key, name, description };
  });
}

export class GameManager {
  constructor() {
    this.rooms = new Map();
    this.geminiService = new GeminiService();
  }

  createRoom(hostPlayerName, socket, options = {}) {
    let code;
    do {
      code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (this.rooms.has(code));

    const room = new Room(code, hostPlayerName, options);
    room.addPlayer(hostPlayerName, socket);
    if (room.singleDevice) {
      for (const playerName of (options.playerNames || [hostPlayerName]).slice(1)) room.addPlayer(playerName, socket);
    }
    this.rooms.set(code, room);
    return room;
  }

  joinRoom(code, playerName, socket) {
    const room = this.rooms.get(code);
    if (!room) throw new Error('Room not found.');
    if (room.singleDevice) throw new Error('This game is using one shared device.');
    if (room.status !== 'WAITING') throw new Error('Game already in progress.');
    if (room.players.has(playerName)) throw new Error('Player name taken in this room.');

    room.addPlayer(playerName, socket);
    return room;
  }

  setTimerDuration(roomCode, playerName, seconds) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error('Room not found.');
    if (room.host !== playerName) throw new Error('Only the room host can update settings.');
    if (room.status !== 'WAITING') throw new Error('Cannot change settings while a game is in progress.');

    const updated = room.setTimerDuration(seconds);
    if (!updated) throw new Error('Invalid duration. Timer must be between 30 and 600 seconds.');

    room.broadcast({
      type: 'ROOM_SETTINGS_UPDATED',
      timerDuration: room.timerDuration
    });
  }

  async startRound(roomCode, playerName, isNextRound = false) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error('Room not found.');
    if (room.host !== playerName) throw new Error('Only the room host can start the game.');
    if (room.status !== 'WAITING' || (isNextRound ? room.roundNumber < 2 : room.roundNumber !== 0)) {
      throw new Error('The game has already started.');
    }

    room.status = 'WRITING';
    if (!isNextRound) room.roundNumber = 1;
    room.submissions.clear();
    room.endGameRequested = false;
    room.currentTurnIndex = 0;
    room.currentTurnName = room.singleDevice ? room.getPlayerList()[0] : null;

    // Request prompt/topic generation from AI service
    room.currentPrompt = await this.geminiService.generatePrompt({
      genre: room.genre,
      keywords: room.keywords,
      previousTitles: room.promptTitles
    });
    room.promptTitles.push(room.currentPrompt.title);
    room.timeRemaining = room.timerDuration;

    room.broadcast({
      type: 'ROUND_STARTED',
      prompt: room.currentPrompt,
      duration: room.timerDuration,
      roundNumber: room.roundNumber,
      totalRounds: room.totalRounds,
      metrics: room.customMetrics,
      singleDevice: room.singleDevice,
      currentPlayerName: room.currentTurnName,
      status: room.status
    });

    this.startTurnTimer(roomCode, room);
  }

  startTurnTimer(roomCode, room) {
    if (room.timerInterval) clearInterval(room.timerInterval);
    room.timerInterval = setInterval(() => {
      room.timeRemaining -= 1;

      room.broadcast({
        type: 'TIMER_TICK',
        timeRemaining: room.timeRemaining
      });

      if (room.timeRemaining <= 0) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
        room.broadcast({ type: 'ROUND_TIME_UP' });
        room.submissionTimeout = setTimeout(() => {
          room.submissionTimeout = null;
          if (room.singleDevice && room.currentTurnName && !room.submissions.has(room.currentTurnName)) {
            this.submitStory(roomCode, room.host, '');
          } else if (!room.singleDevice) {
            this.evaluateRound(roomCode);
          }
        }, 2000);
      }
    }, 1000);
  }

  async nextRound(roomCode, playerName) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error('Room not found.');
    if (room.host !== playerName) throw new Error('Only the room host can start the next round.');
    if (room.status !== 'FINISHED') throw new Error('The current round is not finished.');

    if (room.roundNumber >= room.totalRounds) {
      await this.completeGame(room);
      return;
    }

    room.status = 'WAITING';
    room.roundNumber += 1;
    await this.startRound(roomCode, playerName, true);
  }

  async endGame(roomCode, playerName) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error('Room not found.');
    if (room.host !== playerName) throw new Error('Only the room host can finish the game.');
    if (room.roundNumber === 0) throw new Error('Start the game before finishing it.');
    if (room.status === 'GAME_OVER') return;

    if (room.status === 'JUDGING') {
      room.endGameRequested = true;
      room.broadcast({ type: 'GAME_END_PENDING' });
      return;
    }

    if (room.status === 'WRITING') {
      room.endGameRequested = true;
      if (room.timerInterval) clearInterval(room.timerInterval);
      if (room.submissionTimeout) clearTimeout(room.submissionTimeout);
      room.submissionTimeout = null;
      await this.evaluateRound(roomCode);
      return;
    }

    if (room.status === 'FINISHED' || room.status === 'WAITING') {
      await this.completeGame(room);
      return;
    }

    throw new Error('The game cannot be finished in its current state.');
  }

  async completeGame(room) {
    if (room.status === 'GAME_OVER') return;
    if (room.timerInterval) clearInterval(room.timerInterval);
    if (room.submissionTimeout) clearTimeout(room.submissionTimeout);
    room.submissionTimeout = null;

    const standings = Array.from(room.scoreTotals, ([name, totalScore]) => ({
      playerName: name,
      totalScore
    })).sort((first, second) => second.totalScore - first.totalScore);

    room.status = 'GAME_OVER';
    let report = { awards: [], playerTraits: [] };
    if (room.storyHistory.length) {
      try {
        report = await this.geminiService.generateGameAwards(room.storyHistory, standings);
      } catch (err) {
        report.error = 'AI awards and player traits could not be generated.';
      }
    } else {
      report.error = 'No stories were submitted, so awards and player traits are unavailable.';
    }

    room.broadcast({
      type: 'GAME_OVER',
      standings,
      awards: report.awards || [],
      playerTraits: report.playerTraits || [],
      reportError: report.error || null
    });
  }

  submitStory(roomCode, playerName, story) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error('Room not found.');
    if (room.status !== 'WRITING') throw new Error('Not in writing phase.');
    if (!room.players.has(playerName)) throw new Error('Player is not in this room.');

    const submittingPlayer = room.singleDevice ? room.currentTurnName : playerName;
    if (!submittingPlayer || room.submissions.has(submittingPlayer)) return;

    room.storyHistory.push({ playerName: submittingPlayer, story, roundNumber: room.roundNumber });
    room.submissions.set(submittingPlayer, story);

    room.broadcast({
      type: 'PLAYER_SUBMITTED',
      playerName: submittingPlayer,
      submittedCount: room.submissions.size,
      totalPlayers: room.players.size
    });

    if (room.submissions.size >= room.players.size) {
      if (room.timerInterval) clearInterval(room.timerInterval);
      room.timerInterval = null;
      if (room.submissionTimeout) clearTimeout(room.submissionTimeout);
      room.submissionTimeout = null;
      this.evaluateRound(roomCode);
    } else if (room.singleDevice) {
      if (room.timerInterval) clearInterval(room.timerInterval);
      room.timerInterval = null;
      if (room.submissionTimeout) clearTimeout(room.submissionTimeout);
      room.submissionTimeout = null;
      room.currentTurnIndex += 1;
      room.currentTurnName = room.getPlayerList()[room.currentTurnIndex];
      room.broadcast({ type: 'PLAYER_TURN', currentPlayerName: room.currentTurnName });
      room.timeRemaining = room.timerDuration;
      this.startTurnTimer(roomCode, room);
    }
  }

  async evaluateRound(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || room.status === 'JUDGING') return;
    if (room.submissionTimeout) clearTimeout(room.submissionTimeout);
    room.submissionTimeout = null;

    room.status = 'JUDGING';
    room.broadcast({ type: 'ROUND_JUDGING', status: 'Evaluating stories...' });

    const submissionsList = Array.from(room.submissions.entries()).map(([playerName, story]) => ({
      playerName,
      story
    }));

    if (submissionsList.length === 0) {
      room.status = 'FINISHED';
      await this.completeGame(room);
      return;
    }

    try {
      const evaluations = await this.geminiService.judgeStories(
        room.currentPrompt.title,
        room.currentPrompt.genre,
        room.currentPrompt.keywords,
        submissionsList,
        room.customMetrics
      );

      for (const evaluation of evaluations) {
        const roundScore = Number(evaluation.totalScore) || 0;
        room.scoreTotals.set(
          evaluation.playerName,
          (room.scoreTotals.get(evaluation.playerName) || 0) + roundScore
        );
        const storyRecord = room.storyHistory.find((submission) =>
          submission.playerName === evaluation.playerName && submission.roundNumber === room.roundNumber
        );
        if (storyRecord) storyRecord.totalScore = roundScore;
      }

      room.status = 'FINISHED';
      room.broadcast({
        type: 'ROUND_RESULTS',
        evaluations,
        roundNumber: room.roundNumber,
        totalRounds: room.totalRounds,
        status: 'FINISHED'
      });
      if (room.endGameRequested) await this.completeGame(room);
    } catch (err) {
      if (room.endGameRequested) {
        room.status = 'FINISHED';
        await this.completeGame(room);
        return;
      }
      room.status = 'WAITING';
      room.broadcast({
        type: 'ERROR',
        message: `Judging failed: ${err.message}`
      });
    }
  }
}