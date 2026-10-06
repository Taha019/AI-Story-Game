import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GameManager } from './gameManager.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const gameManager = new GameManager();

app.use(express.static(path.join(__dirname, '../public')));

let nextSocketId = 1;

wss.on('connection', (ws) => {
  ws.id = `user_${nextSocketId++}`;

  ws.on('message', async (message) => {
    try {
      const payload = JSON.parse(message);
      switch (payload.type) {
        case 'CREATE_ROOM': {
          const room = gameManager.createRoom(
            ws,
            payload.playerName,
            payload.apiKey,
            payload.totalRounds,
            payload.metrics
          );
          ws.send(JSON.stringify({ type: 'ROOM_CREATED', roomCode: room.code, socketId: ws.id }));
          gameManager.broadcastRoomUpdate(room);
          break;
        }
        case 'JOIN_ROOM': {
          const result = gameManager.joinRoom(payload.roomCode, ws, payload.playerName);
          if (result.error) {
            ws.send(JSON.stringify({ type: 'ERROR', message: result.error }));
          } else {
            ws.send(JSON.stringify({ type: 'ROOM_JOINED', roomCode: result.room.code, socketId: ws.id }));
            gameManager.broadcastRoomUpdate(result.room);
          }
          break;
        }
        case 'START_GAME': {
          await gameManager.startRound(payload.roomCode);
          break;
        }
        case 'SUBMIT_STORY': {
          gameManager.submitStory(payload.roomCode, ws.id, payload.story);
          break;
        }
        case 'NEXT_ROUND': {
          gameManager.advanceGame(payload.roomCode);
          break;
        }
      }
    } catch (err) {
      console.error('Socket message error:', err);
      ws.send(JSON.stringify({ type: 'ERROR', message: err.message }));
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
  console.log(`Server running on http://localhost:${PORT}`);
});