import { GeminiService } from './geminiService.js';

export class Room {
  constructor(code, hostPlayerName) {
    this.code = code;
    this.host = hostPlayerName;
    this.players = new Map(); // playerName -> socket
    this.timerDuration = 300; // Default duration in seconds
    this.status = 'WAITING'; // WAITING, WRITING, JUDGING, FINISHED
    this.currentPrompt = null;
    this.submissions = new Map(); // playerName -> story text string
    
    // Custom criteria evaluated on a 1-10 integer scale
    this.customMetrics = [
      { key: 'creativity', name: 'Creativity', description: 'Originality and imaginative narrative elements.' },
      { key: 'coherence', name: 'Coherence', description: 'Logical story flow and grammar quality.' },
      { key: 'keywordUsage', name: 'Keyword Usage', description: 'Seamless incorporation of required words.' }
    ];
    
    this.timerInterval = null;
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

  createRoom(hostPlayerName, socket) {
    let code;
    do {
      code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (this.rooms.has(code));

    const room = new Room(code, hostPlayerName);
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

  async startRound(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error('Room not found.');

    room.status = 'WRITING';
    room.submissions.clear();

    // Request prompt/topic generation from AI service
    room.currentPrompt = await this.geminiService.generatePrompt();
    room.timeRemaining = room.timerDuration;

    room.broadcast({
      type: 'ROUND_STARTED',
      prompt: room.currentPrompt,
      duration: room.timerDuration,
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
        this.evaluateRound(roomCode);
      }
    }, 1000);
  }

  submitStory(roomCode, playerName, story) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error('Room not found.');
    if (room.status !== 'WRITING') throw new Error('Not in writing phase.');

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
      this.evaluateRound(roomCode);
    }
  }

  async evaluateRound(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || room.status === 'JUDGING') return;

    room.status = 'JUDGING';
    room.broadcast({ type: 'ROUND_JUDGING', status: 'Evaluating stories...' });

    const submissionsList = Array.from(room.submissions.entries()).map(([playerName, story]) => ({
      playerName,
      story
    }));

    if (submissionsList.length === 0) {
      room.status = 'WAITING';
      room.broadcast({ type: 'GAME_OVER', evaluations: [], winner: 'No submissions received.' });
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

      room.status = 'FINISHED';
      room.broadcast({
        type: 'ROUND_RESULTS',
        evaluations,
        status: 'FINISHED'
      });
    } catch (err) {
      room.status = 'WAITING';
      room.broadcast({
        type: 'ERROR',
        message: `Judging failed: ${err.message}`
      });
    }
  }
}