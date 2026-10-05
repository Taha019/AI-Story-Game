import { GeminiService } from './geminiService.js';

export class GameManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(hostSocket, hostName, totalRounds = 3, metrics = []) {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Default metrics if none provided
    const defaultMetrics = [
      { key: 'creativity', name: 'Creativity', description: 'Originality and imagery' },
      { key: 'coherence', name: 'Coherence', description: 'Narrative flow and readability' },
      { key: 'adherence', name: 'Adherence', description: 'Fit with prompt and required keywords' }
    ];

    const room = {
      code: roomCode,
      apiKey: process.env.GEMINI_API_KEY,
      status: 'LOBBY',
      players: [{ id: hostSocket.id, name: hostName, socket: hostSocket, story: null, cumulativeScore: 0 }],
      prompt: null,
      currentTurnIndex: 0,
      currentRound: 1,
      totalRounds: parseInt(totalRounds, 10) || 3,
      metrics: metrics.length > 0 ? metrics : defaultMetrics,
      roundHistory: [], // stores per-round results
      results: null
    };
    this.rooms.set(roomCode, room);
    return room;
  }

  joinRoom(roomCode, socket, playerName) {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) return { error: 'Room not found. Check your Lobby ID.' };
    if (room.status !== 'LOBBY') return { error: 'Game already in progress.' };
    if (room.players.length >= 5) return { error: 'Room is full (limit 5 players).' };

    room.players.push({ id: socket.id, name: playerName, socket, story: null, cumulativeScore: 0 });
    return { room };
  }

  async startRound(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || room.players.length < 2) return;

    // Clear individual story submissions for the new round
    room.players.forEach(p => p.story = null);

    const gemini = new GeminiService(room.apiKey);
    room.prompt = await gemini.generatePrompt();
    room.status = 'WRITING';
    room.currentTurnIndex = 0;
    this.broadcastRoomUpdate(room);
  }

  submitStory(roomCode, playerId, storyText) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (currentPlayer && currentPlayer.id === playerId) {
      currentPlayer.story = storyText;
      this.nextTurn(room);
    }
  }

  async nextTurn(room) {
    room.currentTurnIndex++;
    if (room.currentTurnIndex >= room.players.length) {
      // All players finished writing -> trigger judging
      room.status = 'JUDGING';
      this.broadcastRoomUpdate(room);

      try {
        const gemini = new GeminiService(room.apiKey);
        const submissions = room.players.map(p => ({ playerName: p.name, story: p.story || '' }));
        const evaluations = await gemini.judgeStories(room.prompt.title, room.prompt.genre, room.prompt.keywords, submissions, room.metrics);

        // Calculate scores and cumulative tally
        const roundResults = evaluations.map(evalData => {
          const scoreValues = Object.values(evalData.scores || {});
          const roundTotal = scoreValues.reduce((acc, curr) => acc + (Number(curr) || 0), 0);
          
          // Add to player's persistent cumulative score
          const player = room.players.find(p => p.name === evalData.playerName);
          if (player) {
            player.cumulativeScore += roundTotal;
          }

          return {
            ...evalData,
            roundTotal,
            cumulativeScore: player ? player.cumulativeScore : roundTotal
          };
        }).sort((a, b) => b.roundTotal - a.roundTotal);

        room.roundHistory.push({
          round: room.currentRound,
          prompt: room.prompt,
          results: roundResults
        });

        room.status = 'ROUND_SUMMARY';
      } catch (err) {
        console.error('Judging failed:', err);
        room.status = 'ERROR';
        room.errorMessage = err.message;
      }
    }
    this.broadcastRoomUpdate(room);
  }

  advanceGame(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    if (room.currentRound < room.totalRounds) {
      room.currentRound++;
      this.startRound(roomCode);
    } else {
      // Game ended -> calculate final totals and awards
      room.status = 'FINAL_RESULTS';
      room.finalLeaderboard = [...room.players].sort((a, b) => b.cumulativeScore - a.cumulativeScore);
      room.awards = this.calculateAwards(room.roundHistory);
      this.broadcastRoomUpdate(room);
    }
  }

  calculateAwards(roundHistory) {
    let highestRoundScore = -1;
    let bestStoryWinner = '';
    let bestStoryTitle = '';

    roundHistory.forEach(r => {
      r.results.forEach(res => {
        if (res.roundTotal > highestRoundScore) {
          highestRoundScore = res.roundTotal;
          bestStoryWinner = res.playerName;
          bestStoryTitle = r.prompt.title;
        }
      });
    });

    return [
      { title: '🏆 Ultimate Champion', recipient: roundHistory[roundHistory.length - 1]?.results[0]?.playerName || 'N/A', desc: 'Highest overall score across all rounds.' },
      { title: '⭐ Master Storyteller', recipient: bestStoryWinner, desc: `Scored the highest single round entry (${highestRoundScore} pts) on "${bestStoryTitle}".` }
    ];
  }

  broadcastRoomUpdate(room) {
    const payload = JSON.stringify({
      type: 'ROOM_UPDATE',
      data: {
        code: room.code,
        status: room.status,
        currentRound: room.currentRound,
        totalRounds: room.totalRounds,
        metrics: room.metrics,
        prompt: room.prompt,
        players: room.players.map(p => ({ name: p.name, cumulativeScore: p.cumulativeScore, hasSubmitted: !!p.story })),
        activePlayerName: room.players[room.currentTurnIndex]?.name,
        activePlayerId: room.players[room.currentTurnIndex]?.id,
        roundHistory: room.roundHistory,
        finalLeaderboard: room.finalLeaderboard,
        awards: room.awards,
        errorMessage: room.errorMessage || null
      }
    });
    room.players.forEach(p => p.socket.send(payload));
  }

  handleDisconnect(socketId) {
    for (const [code, room] of this.rooms.entries()) {
      const idx = room.players.findIndex(p => p.id === socketId);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          this.rooms.delete(code);
        } else {
          this.broadcastRoomUpdate(room);
        }
        break;
      }
    }
  }
}