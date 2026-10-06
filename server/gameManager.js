import { GeminiService } from './geminiService.js';

export class Room {
  constructor(code, hostPlayerName, options = {}) {
    this.code = code;
    this.host = hostPlayerName;
    this.players = new Map(); // playerName -> socket
    this.timerDuration = 300; // Default duration in seconds
    this.setTimerDuration(options.timerDuration);
    this.totalRounds = [1, 2, 3, 5].includes(Number(options.totalRounds)) ? Number(options.totalRounds) : 3;
    this.genre = typeof options.genre === 'string' ? options.genre.trim().slice(0, 80) || null : null;
    this.keywords = Array.isArray(options.keywords)
      ? options.keywords.filter((keyword) => typeof keyword === 'string' && keyword.trim()).slice(0, 8)
      : [];
    this.roundNumber = 0;
    this.scoreTotals = new Map();
    this.status = 'WAITING'; // WAITING, WRITING, JUDGING, FINISHED, GAME_OVER
    this.currentPrompt = null;
    this.submissions = new Map(); // playerName -> story text string
    this.storyHistory = [];
    this.endGameRequested = false;
    
    // Custom criteria evaluated on a 1-10 integer scale
    this.customMetrics = [
      { key: 'creativity', name: 'Creativity', description: 'Originality and imaginative narrative elements.' },
      { key: 'coherence', name: 'Coherence', description: 'Logical story flow and grammar quality.' },
      { key: 'adherence', name: 'Adherence', description: 'Fit with the story title and prompt.' }
    ];
    if (this.keywords.length) {
      this.customMetrics.push({
        key: 'keywordUsage',
        name: 'Keyword Usage',
        description: 'Seamless incorporation of the required words.'
      });
    }
    
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
    const duration = parseInt(seconds, 10);
    if (!isNaN(duration) && duration >= 30 && duration <= 600) {
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
    for (const socket of this.players.values()) {
      if (socket.readyState === 1) { // WebSocket.OPEN
        socket.send(payload);
      }
    }
  }
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
    this.rooms.set(code, room);
    return room;
  }

  joinRoom(code, playerName, socket) {
    const room = this.rooms.get(code);
    if (!room) throw new Error('Room not found.');
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

    // Request prompt/topic generation from AI service
    room.currentPrompt = await this.geminiService.generatePrompt({
      genre: room.genre,
      keywords: room.keywords
    });
    room.timeRemaining = room.timerDuration;

    room.broadcast({
      type: 'ROUND_STARTED',
      prompt: room.currentPrompt,
      duration: room.timerDuration,
      roundNumber: room.roundNumber,
      totalRounds: room.totalRounds,
      status: room.status
    });

    // Start countdown broadcast interval
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
          this.evaluateRound(roomCode);
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

    if (!room.submissions.has(playerName)) {
      room.storyHistory.push({ playerName, story, roundNumber: room.roundNumber });
    }
    room.submissions.set(playerName, story);

    room.broadcast({
      type: 'PLAYER_SUBMITTED',
      playerName,
      submittedCount: room.submissions.size,
      totalPlayers: room.players.size
    });

    // Automatically trigger evaluations if all players finish before timer expiration
    if (room.submissions.size >= room.players.size) {
      if (room.timerInterval) clearInterval(room.timerInterval);
      if (room.submissionTimeout) clearTimeout(room.submissionTimeout);
      room.submissionTimeout = null;
      this.evaluateRound(roomCode);
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