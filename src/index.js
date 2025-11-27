require('dotenv').config();

// Use built-in fetch on Node 18+, fallback to node-fetch on older runtimes.
const fetch =
  global.fetch ||
  ((...args) => import('node-fetch').then(({ default: fn }) => fn(...args)));

if (typeof ReadableStream === 'undefined') {
  const { ReadableStream } = require('stream/web');
  global.ReadableStream = ReadableStream;
}

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const { Client, Events, GatewayIntentBits, REST, Routes } = require('discord.js');
const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
} = require('@discordjs/voice');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const wsPort = Number(process.env.WS_PORT || 3001);
const httpPort = Number(process.env.HTTP_PORT || 3000);
const clientSecret = process.env.DISCORD_CLIENT_SECRET;
const redirectUri =
  process.env.OAUTH_REDIRECT_URI || `http://localhost:${httpPort}/auth/callback`;

const defaultSoundDir = path.resolve(path.join(__dirname, '..', 'sounds'));
const soundDirs = (process.env.SOUND_DIR || defaultSoundDir)
  .split(',')
  .map((dir) => dir.trim())
  .filter(Boolean)
  .map((dir) => path.resolve(dir));

if (!token || !clientId || !guildId || !clientSecret) {
  throw new Error(
    'Missing env vars. Require DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and DISCORD_GUILD_ID.',
  );
}

const audioPlayer = createAudioPlayer({
  behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
});
let nowPlaying = null;
let wss;
const actionHistory = [];
const historyLimit = Number(process.env.HISTORY_LIMIT);
const MAX_HISTORY = Number.isFinite(historyLimit) && historyLimit >= 0 ? historyLimit : 200;
const SOUND_FILE_REGEX = /\.(mp3|wav|ogg|flac)$/i;

const commands = [
  {
    name: 'join',
    description: 'Join your current voice channel',
  },
  {
    name: 'leave',
    description: 'Leave the current voice channel',
  },
];

const rest = new REST({ version: '10' }).setToken(token);

async function registerCommands() {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log('Slash commands registered for guild', guildId);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'join') {
    const memberChannel = interaction.member?.voice?.channel;
    if (!memberChannel) {
      await interaction.reply({
        content: 'You need to be in a voice channel before using /join.',
        ephemeral: true,
      });
      return;
    }

    const existing = getVoiceConnection(interaction.guild.id);
    if (existing) {
      if (existing.joinConfig.channelId === memberChannel.id) {
        await interaction.reply({
          content: 'I am already in your voice channel.',
          ephemeral: true,
        });
        return;
      }
      existing.destroy();
    }

    try {
      const connection = joinVoiceChannel({
        channelId: memberChannel.id,
        guildId: memberChannel.guild.id,
        adapterCreator: memberChannel.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
      await interaction.reply({
        content: `Joined ${memberChannel.name}.`,
        ephemeral: true,
      });
      broadcast({ type: 'status', connected: true, channel: memberChannel.name });
    } catch (error) {
      console.error('Failed to join voice channel:', error);
      await interaction.reply({
        content: 'Could not join the voice channel. Check my permissions and try again.',
        ephemeral: true,
      });
    }
    return;
  }

  if (interaction.commandName === 'leave') {
    const connection = getVoiceConnection(interaction.guild.id);
    if (!connection) {
      await interaction.reply({
        content: 'I am not in a voice channel.',
        ephemeral: true,
      });
      return;
    }

    connection.destroy();
    audioPlayer.stop();
    nowPlaying = null;
    await interaction.reply({
      content: 'Left the voice channel.',
      ephemeral: true,
    });
    broadcast({ type: 'status', connected: false });
    broadcast({ type: 'nowPlaying', name: null });
  }
});

function listSounds() {
  try {
    const seen = new Set();
    soundDirs.forEach((dir) => {
      try {
        fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
          if (!entry.isFile()) return;
          if (!SOUND_FILE_REGEX.test(entry.name)) return;
          if (!seen.has(entry.name)) {
            seen.add(entry.name);
          }
        });
      } catch (error) {
        console.error(`Error reading sounds directory ${dir}:`, error);
      }
    });
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  } catch (error) {
    console.error('Error reading sounds directories:', error);
    return [];
  }
}

function broadcast(payload) {
  if (!wss) return;
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function playSoundByName(name) {
  const connection = getVoiceConnection(guildId);
  if (!connection) {
    throw new Error('Bot is not connected to a voice channel. Use /join first.');
  }

  const safeName = path.basename(name);
  let filePath = null;

  for (const dir of soundDirs) {
    const candidate = path.resolve(dir, safeName);
    const relative = path.relative(dir, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      continue;
    }
    if (fs.existsSync(candidate)) {
      filePath = candidate;
      break;
    }
  }

  if (!filePath) {
    throw new Error('Sound not found.');
  }

  const resource = createAudioResource(filePath);
  connection.subscribe(audioPlayer);
  nowPlaying = safeName;
  audioPlayer.play(resource);
  broadcast({ type: 'nowPlaying', name: nowPlaying });
  return safeName;
}

function signSession(user) {
  const safeUser = formatUserForClient(user);
  const payload = JSON.stringify({ user: safeUser, iat: Date.now() });
  const base = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', clientSecret).update(base).digest('base64url');
  return `${base}.${sig}`;
}

function getSession(token) {
  if (!token) return null;
  const [base, sig] = token.split('.');
  if (!base || !sig) return null;
  const expected = crypto.createHmac('sha256', clientSecret).update(base).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(base, 'base64url').toString('utf8'));
    return { user: parsed.user, createdAt: parsed.iat };
  } catch (_err) {
    return null;
  }
}

function pruneHistory() {
  if (MAX_HISTORY <= 0) return;
  if (actionHistory.length > MAX_HISTORY) {
    actionHistory.length = MAX_HISTORY;
  }
}

function formatUserForClient(user) {
  const discriminator =
    (user.discriminator || user.discriminator === 0) && user.discriminator !== '0'
      ? user.discriminator
      : user.discriminator === 0
        ? '0'
        : null;
  return {
    id: user.id,
    username: user.username,
    globalName: user.global_name || user.globalName || null,
    discriminator,
    avatar: user.avatar,
  };
}

function handleSocketMessage(socket, message) {
  let parsed;
  try {
    parsed = JSON.parse(message);
  } catch (error) {
    socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload.' }));
    return;
  }

  if (parsed.type === 'play') {
    if (!parsed.name) {
      socket.send(JSON.stringify({ type: 'error', message: 'Missing sound name.' }));
      return;
    }

    const session = getSession(parsed.token);
    if (!session) {
      socket.send(
        JSON.stringify({ type: 'error', message: 'Debes iniciar sesión con Discord primero.' }),
      );
      return;
    }

      try {
        const sound = playSoundByName(parsed.name);
        const entry = {
          sound,
          at: Date.now(),
        user: formatUserForClient(session.user),
      };
      actionHistory.unshift(entry);
      pruneHistory();
      broadcast({ type: 'history', entries: actionHistory });
      socket.send(
        JSON.stringify({
          type: 'ack',
          action: 'play',
          ok: true,
          name: sound,
          user: entry.user,
          at: entry.at,
        }),
      );
    } catch (error) {
      socket.send(JSON.stringify({ type: 'error', message: error.message }));
    }
    return;
  }

  if (parsed.type === 'list') {
    socket.send(JSON.stringify({ type: 'sounds', sounds: listSounds() }));
    return;
  }

  socket.send(JSON.stringify({ type: 'error', message: 'Unknown message type.' }));
}

function startWebSocketServer() {
  wss = new WebSocketServer({ port: wsPort });
  console.log(`WebSocket server listening on ws://localhost:${wsPort}`);

  // Keep connections alive and clean up dead peers so intermediaries (proxies, gateways)
  // do not close idle sockets.
  const heartbeat = setInterval(() => {
    wss.clients.forEach((socket) => {
      if (socket.isAlive === false) {
        socket.terminate();
        return;
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, 30_000);

  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.send(JSON.stringify({ type: 'sounds', sounds: listSounds() }));
    socket.send(
      JSON.stringify({
        type: 'status',
        connected: Boolean(getVoiceConnection(guildId)),
      }),
    );
    socket.send(JSON.stringify({ type: 'nowPlaying', name: nowPlaying }));
    socket.send(JSON.stringify({ type: 'history', entries: actionHistory }));

    socket.on('message', (data) => handleSocketMessage(socket, data.toString()));
  });
}

audioPlayer.on(AudioPlayerStatus.Playing, () => {
  broadcast({ type: 'nowPlaying', name: nowPlaying });
});

audioPlayer.on(AudioPlayerStatus.Idle, () => {
  nowPlaying = null;
  broadcast({ type: 'nowPlaying', name: null });
});

audioPlayer.on('error', (error) => {
  console.error('Audio player error:', error);
  broadcast({ type: 'error', message: 'Audio playback failed.' });
});

async function exchangeCodeForUser(code) {
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      scope: 'identify',
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Discord token exchange failed: ${text}`);
  }

  const tokenData = await tokenRes.json();
  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    const text = await userRes.text();
    throw new Error(`Discord user fetch failed: ${text}`);
  }

  return userRes.json();
}

function respondJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

function startHttpServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/auth/login') {
      const authorizeUrl = new URL('https://discord.com/api/oauth2/authorize');
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('scope', 'identify');
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('prompt', 'consent');

      res.writeHead(302, { Location: authorizeUrl.toString() });
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/auth/callback') {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<p>Discord login failed: ${error}</p>`);
        return;
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<p>Missing authorization code.</p>');
        return;
      }

      try {
        const user = await exchangeCodeForUser(code);
        const token = signSession(user);
        const safeUser = formatUserForClient(user);
        const payload = JSON.stringify({ token, user: safeUser });
        const html = `
          <!doctype html>
          <html>
            <body style="background:#0b0d11;color:#f7f7f7;font-family:Arial;padding:24px;">
              <h2>Discord login listo</h2>
              <p>Puedes cerrar esta ventana.</p>
              <script>
                (function() {
                  const payload = ${JSON.stringify(payload)};
                  if (window.opener) {
                    window.opener.postMessage(JSON.parse(payload), '*');
                    window.close();
                  } else {
                    document.body.innerHTML += '<pre>' + payload + '</pre>';
                  }
                })();
              </script>
            </body>
          </html>
        `;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<p>Error during Discord login: ${err.message}</p>`);
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/auth/session') {
      const token = url.searchParams.get('token');
      const session = getSession(token);
      if (!session) {
        respondJson(res, 401, { ok: false, error: 'Invalid session' });
        return;
      }
      respondJson(res, 200, { ok: true, user: formatUserForClient(session.user) });
      return;
    }

    respondJson(res, 404, { ok: false, error: 'Not found' });
  });

  server.listen(httpPort, () => {
    console.log(`HTTP auth server listening on http://localhost:${httpPort}`);
    console.log(`Discord redirect URI: ${redirectUri}`);
  });
}

async function start() {
  await registerCommands();
  startHttpServer();
  startWebSocketServer();
  await client.login(token);
}

start().catch((error) => {
  console.error('Bot failed to start:', error);
  process.exit(1);
});
