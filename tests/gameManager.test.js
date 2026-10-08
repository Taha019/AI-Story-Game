import test from 'node:test';
import assert from 'node:assert/strict';
import { GameManager } from '../server/gameManager.js';

test('completeGame includes all submitted stories in the final payload', async () => {
  const gameManager = new GameManager();
  const room = {
    code: '1234',
    status: 'WAITING',
    timerInterval: null,
    submissionTimeout: null,
    scoreTotals: new Map([
      ['Alice', 10],
      ['Bob', 8]
    ]),
    storyHistory: [
      { playerName: 'Alice', story: 'The moon stitched a map across the city.', roundNumber: 1 },
      { playerName: 'Bob', story: 'A whale in a library kept the secrets of the stars.', roundNumber: 1 }
    ],
    endGameRequested: false,
    broadcast: (message) => {
      room.lastBroadcast = message;
    }
  };

  gameManager.geminiService.generateGameAwards = async () => ({
    awards: [],
    playerTraits: []
  });

  await gameManager.completeGame(room);

  assert.equal(room.lastBroadcast.type, 'GAME_OVER');
  assert.deepEqual(room.lastBroadcast.stories, room.storyHistory);
  assert.equal(room.lastBroadcast.stories.length, 2);
});

test('generatePrompt honors the requested title difficulty', async () => {
  const gameManager = new GameManager();
  const service = gameManager.geminiService;

  service.requestStoryTitle = async (previousTitles, difficulty) => {
    assert.deepEqual(previousTitles, []);
    assert.equal(difficulty, 'hard');
    return 'The Clockmaker of Ash';
  };

  const prompt = await service.generatePrompt({ previousTitles: [], titleDifficulty: 'hard' });

  assert.equal(prompt.title, 'The Clockmaker of Ash');
  assert.equal(prompt.genre, null);
  assert.equal(prompt.titleDifficulty, 'hard');
});
