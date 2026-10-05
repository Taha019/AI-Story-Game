import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GameManager } from './gameManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

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
    gameManager.handleDisconnect(ws.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});