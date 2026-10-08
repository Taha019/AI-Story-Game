import 'dotenv/config';
import { WebSocketServer } from 'ws';
import http from 'http';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GameManager } from './gameManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const gameManager = new GameManager();

// Resolve client path robustly for production deployments
const clientPath = path.resolve(__dirname, '../public');

if (fs.existsSync(clientPath)) {
  console.log(`Serving static assets from: ${clientPath}`);
  app.use(express.static(clientPath));

  app.get('*', (req, res) => {
    const indexPath = path.join(clientPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('index.html not found inside client directory.');
    }
  });
} else {
  console.error(`Directory not found at ${clientPath}`);
  app.get('*', (req, res) => {
    res.status(404).send('Client static directory not found on server.');
  });
}

wss.on('connection', (ws) => {
  let currentRoomCode = null;
  let currentPlayerName = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'CREATE_ROOM': {
          currentPlayerName = typeof data.playerName === 'string' ? data.playerName.trim() : '';
          if (!currentPlayerName) throw new Error('Please enter a display name.');
          const singleDevice = data.singleDevice === true;
          const playerNames = singleDevice && Array.isArray(data.playerNames)
            ? data.playerNames.map((name) => typeof name === 'string' ? name.trim() : '')
            : [currentPlayerName];
          if (singleDevice && (playerNames.length < 2 || playerNames.length > 5 || playerNames.some((name) => !name))) {
            throw new Error('Enter names for 2 to 5 players.');
          }
          if (singleDevice && (playerNames[0] !== currentPlayerName || new Set(playerNames.map((name) => name.toLowerCase())).size !== playerNames.length)) {
            throw new Error('Each player needs a unique name, with the first player listed first.');
          }
          const keywords = typeof data.keywords === 'string'
            ? data.keywords.split(',').map((keyword) => keyword.trim()).filter(Boolean).slice(0, 8)
            : [];
          const room = gameManager.createRoom(currentPlayerName, ws, {
            totalRounds: data.totalRounds,
            timerDuration: data.timerDuration,
            genre: data.genre,
            keywords,
            singleDevice,
            playerNames,
            metrics: data.metrics,
            titleDifficulty: data.titleDifficulty
          });
          currentRoomCode = room.code;

          ws.send(JSON.stringify({
            type: 'ROOM_CREATED',
            roomCode: room.code,
            host: room.host,
            players: room.getPlayerList(),
            timerDuration: room.timerDuration,
            singleDevice: room.singleDevice,
            metrics: room.customMetrics
          }));
          break;
        }

        case 'JOIN_ROOM': {
          const playerName = data.playerName?.trim();
          const roomCode = data.roomCode?.trim();
          if (!playerName) throw new Error('Please enter your display name.');
          if (!roomCode) throw new Error('Please enter a room code.');

          const room = gameManager.joinRoom(roomCode, playerName, ws);
          currentPlayerName = playerName;
          currentRoomCode = roomCode;

          ws.send(JSON.stringify({
            type: 'ROOM_JOINED',
            roomCode: room.code,
            players: room.getPlayerList(),
            timerDuration: room.timerDuration,
            metrics: room.customMetrics
          }));

          const playerJoined = JSON.stringify({
            type: 'PLAYER_JOINED',
            players: room.getPlayerList(),
            host: room.host,
            timerDuration: room.timerDuration,
            metrics: room.customMetrics
          });
          for (const [name, playerSocket] of room.players) {
            if (name !== playerName && playerSocket.readyState === 1) {
              playerSocket.send(playerJoined);
            }
          }
          break;
        }

        case 'UPDATE_ROOM_SETTINGS': {
          if (!currentRoomCode || !currentPlayerName) return;
          gameManager.setTimerDuration(currentRoomCode, currentPlayerName, data.timerDuration);
          break;
        }

        case 'START_GAME': {
          if (!currentRoomCode) return;
          await gameManager.startRound(currentRoomCode, currentPlayerName);
          break;
        }

        case 'NEXT_ROUND': {
          if (!currentRoomCode || !currentPlayerName) return;
          await gameManager.nextRound(currentRoomCode, currentPlayerName);
          break;
        }

        case 'END_GAME': {
          if (!currentRoomCode || !currentPlayerName) return;
          await gameManager.endGame(currentRoomCode, currentPlayerName);
          break;
        }

        case 'SUBMIT_STORY': {
          if (!currentRoomCode || !currentPlayerName) return;
          gameManager.submitStory(currentRoomCode, currentPlayerName, data.story);
          break;
        }
      }
    } catch (err) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: err.message
      }));
    }
  });

  ws.on('close', () => {
    if (currentRoomCode && currentPlayerName) {
      const room = gameManager.rooms.get(currentRoomCode);
      if (room) {
        const removedPlayers = [...room.players]
          .filter(([, playerSocket]) => playerSocket === ws)
          .map(([name]) => name);
        removedPlayers.forEach((name) => room.removePlayer(name));
        if (room.players.size === 0) {
          if (room.timerInterval) clearInterval(room.timerInterval);
          gameManager.rooms.delete(currentRoomCode);
        } else {
          room.broadcast({
            type: 'PLAYER_LEFT',
            playerName: removedPlayers.join(', '),
            players: room.getPlayerList(),
            host: room.host
          });
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});