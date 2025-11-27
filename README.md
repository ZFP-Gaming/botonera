# Discord bot + React soundboard

Simple JavaScript Discord bot with slash commands `/join` and `/leave`. A local React app connects over WebSocket, lists files from the `sounds/` folder, and triggers playback in the connected voice channel.

## Requirements
- Node.js 18+
- Discord bot with **Guilds** and **Guild Voice States** intents enabled, invited with `CONNECT` and `SPEAK`.

Environment variables (`.env`):
- `DISCORD_TOKEN`: bot token
- `DISCORD_CLIENT_ID`: application/bot ID
- `DISCORD_CLIENT_SECRET`: OAuth client secret (needed for web login)
- `DISCORD_GUILD_ID`: target guild where commands are registered
- `WS_PORT`: WebSocket port for the control UI (default `3001`)
- `HTTP_PORT`: HTTP port for OAuth/login helper (default `3000`)
- `OAUTH_REDIRECT_URI`: Discord redirect URI (defaults to `http://localhost:${HTTP_PORT}/auth/callback`)
- `SOUND_DIR`: absolute path to your sounds folder (default `./sounds` in the repo)

## Backend (bot + WebSocket)
Install and run from repo root:
```bash
npm install
npm start
```

Use `/join` in Discord while you are in a voice channel so the bot connects. The bot exposes a WebSocket at `ws://localhost:${WS_PORT}` that the React UI uses to list and play sounds.

### Discord login and history
The backend also runs a small HTTP server (default `http://localhost:3000`) to handle Discord OAuth login for the web UI.
- In the Discord Developer Portal, add the redirect URI `http://localhost:3000/auth/callback` (or your custom `OAUTH_REDIRECT_URI`) to the app.
- From the React app, click **Conectar con Discord**; it opens the OAuth flow and issues a local session token.
- WebSocket `play` actions now include that session token so the server can record who triggered each sound. A history feed is broadcast to all connected UIs.

## Frontend (React)
The UI lives in `web/` and talks to the bot over WebSocket.
```bash
cd web
npm install
npm run dev -- --host
```

Open the printed URL (default `http://localhost:5173`). Buttons map to files inside `sounds/`; clicking sends `{ type: "play", name: "<file>", token: "<session>" }` over WebSocket. You can override the WS endpoint with `VITE_WS_URL=ws://host:port npm run dev` and the OAuth helper base with `VITE_API_URL=http://host:port`.
