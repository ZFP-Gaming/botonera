# Discord bot + React soundboard

Simple JavaScript Discord bot with slash commands `/join` and `/leave`. A local React app connects over WebSocket, lists files from the `sounds/` folder, and triggers playback in the connected voice channel.

## Requirements
- Node.js 18+
- Discord bot with **Guilds** and **Guild Voice States** intents enabled, invited with `CONNECT` and `SPEAK`.

Environment variables (`.env`):
- `DISCORD_TOKEN`: bot token
- `DISCORD_CLIENT_ID`: application/bot ID
- `DISCORD_GUILD_ID`: target guild where commands are registered
- `WS_PORT`: WebSocket port for the control UI (default `3001`)

## Backend (bot + WebSocket)
Install and run from repo root:
```bash
npm install
npm start
```

Use `/join` in Discord while you are in a voice channel so the bot connects. The bot exposes a WebSocket at `ws://localhost:${WS_PORT}` that the React UI uses to list and play sounds.

## Frontend (React)
The UI lives in `web/` and talks to the bot over WebSocket.
```bash
cd web
npm install
npm run dev -- --host
```

Open the printed URL (default `http://localhost:5173`). Buttons map to files inside `sounds/`; clicking sends `{ type: "play", name: "<file>" }` over WebSocket. You can override the WS endpoint with `VITE_WS_URL=ws://host:port npm run dev`.
