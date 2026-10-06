import { WebSocketServer } from 'ws';
import http from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameManager } from './gameManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const gameManager = new GameManager();

const clientPath = path.join(__dirname, '../client');

// Serve static client assets (HTML, CSS, JS)
app.use(express.static(clientPath));

// Fallback GET handler to ensure index.html is served for root or sub-routes
app.get('*', (req, res) => {
  res.sendFile(path.join(clientPath, 'index.html'));
});

wss.on('connection', (ws) => {
  let currentRoomCode = null;
  let currentPlayerName = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'CREATE_ROOM': {
          currentPlayerName = data.playerName;
          const room = gameManager.createRoom(currentPlayerName, ws);
          currentRoomCode = room.code;

          ws.send(JSON.stringify({
            type: 'ROOM_CREATED',
            roomCode: room.code,
            host: room.host,
            players: room.getPlayerList(),
            timerDuration: room.timerDuration
          }));
          break;
        }

        case 'JOIN_ROOM': {
          currentPlayerName = data.playerName;
          currentRoomCode = data.roomCode;
          const room = gameManager.joinRoom(currentRoomCode, currentPlayerName, ws);

          room.broadcast({
            type: 'PLAYER_JOINED',
            players: room.getPlayerList(),
            host: room.host,
            timerDuration: room.timerDuration
          });
          break;
        }

        case 'UPDATE_ROOM_SETTINGS': {
          if (!currentRoomCode || !currentPlayerName) return;
          gameManager.setTimerDuration(currentRoomCode, currentPlayerName, data.timerDuration);
          break;
        }

        case 'START_GAME': {
          if (!currentRoomCode) return;
          await gameManager.startRound(currentRoomCode);
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
        room.removePlayer(currentPlayerName);
        if (room.players.size === 0) {
          if (room.timerInterval) clearInterval(room.timerInterval);
          gameManager.rooms.delete(currentRoomCode);
        } else {
          room.broadcast({
            type: 'PLAYER_LEFT',
            playerName: currentPlayerName,
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