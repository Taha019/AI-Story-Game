# Ink & Intellect

A real-time, multiplayer AI storytelling game. A host creates a room, invites players with a four-digit code, and starts timed writing rounds. Groq generates story prompts, judges submissions against the room's criteria, and can generate end-of-game awards and story-based player impressions.

## Features

- Create and join multiplayer rooms with a four-digit code (up to five players).
- Choose from one to ten rounds.
- Set the writing timer from 30 to 1,800 seconds, either when creating the room or in the waiting room.
- Optionally choose a genre and comma-separated keywords.
- Use up to four custom judging criteria, each with a name and description.
- Automatically submit the current draft when time expires.
- Let the host advance rounds or finish the game early.
- View round scores, cumulative standings, five end-of-game awards, and tentative writing-based player impressions.

## Requirements

- Node.js 18 or newer.
- A Groq API key for AI prompt generation, judging, and final reports.

AI features use the Groq Chat Completions API. The default model is `openai/gpt-oss-120b`; set `GROQ_MODEL` to override it. Model availability and pricing depend on your Groq account and current provider settings.

## Run Locally

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a `.env` file in the project root:

   ```env
   GROQ_API_KEY=your_groq_api_key
   # Optional; defaults to openai/gpt-oss-120b
   GROQ_MODEL=openai/gpt-oss-120b
   PORT=3000
   ```

   Keep `.env` private. Do not commit API keys or share them in client-side code.

3. Start the server:

   ```sh
   npm start
   ```

4. Open [http://localhost:3000](http://localhost:3000) in a browser. To play across devices, make the server reachable to the other players and give them its URL.

## Play

1. Enter a display name. The host chooses the round count, timer, optional genre and keywords, and judging criteria before creating the room.
2. Share the four-digit room code. Other players enter their display names and the code to join while the room is waiting.
3. The host starts the first round. Players write and submit their stories before the timer ends; any remaining draft is submitted automatically at time-up.
4. After judging, the host can start the next round or finish the game. The host can also finish early during writing.
5. Final standings are shown along with AI-generated awards and story-based impressions when the AI service returns a valid report.

## Deploy on Render

Create a Render Web Service from this repository and configure:

- **Build command:** `npm install`
- **Start command:** `npm start`
- **Environment:** Add `GROQ_API_KEY` as a secret environment variable. `GROQ_MODEL` is optional and defaults to `openai/gpt-oss-120b`.

The server listens on Render's `PORT` environment variable and serves the static client from `public/`. WebSocket connections use `wss://` when the site is served over HTTPS.

## Project Structure

```text
public/
  app.js       Browser UI and WebSocket client
  index.html   Game views and setup form
  style.css    Game styling
server/
  gameManager.js   Rooms, round state, timers, scoring, and game lifecycle
  geminiService.js Groq prompt generation, judging, and final reports
  server.js        Express static server and WebSocket handlers
package.json       Dependencies and npm scripts
```

## Notes

Room state is held in server memory, so rooms are lost when the server restarts. AI requests are made when a round starts, when stories are judged, and when final awards/player impressions are generated. Groq usage, quotas, and charges depend on the account tier and model; check the Groq dashboard for current details.
