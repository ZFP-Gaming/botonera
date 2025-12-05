const { WebSocketServer, WebSocket } = require('ws');

function createWebSocketServer({
  port,
  soundLibrary,
  discordBot,
  sessionService,
  historyService,
}) {
  let wss;

  function broadcast(payload) {
    if (!wss) return;
    const data = JSON.stringify(payload);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  function getTargetGuildId(requestedGuildId) {
    const allowed = new Set(discordBot.getAllowedGuildIds());
    const fallback = discordBot.getDefaultGuildId();
    return allowed.has(requestedGuildId) ? requestedGuildId : fallback;
  }

  function sendInitialState(socket) {
    socket.send(JSON.stringify({ type: 'sounds', sounds: soundLibrary.listSounds() }));
    socket.send(JSON.stringify({ type: 'guilds', guilds: discordBot.listGuildsForClient() }));

    discordBot.getStatusSnapshot().forEach((status) => {
      socket.send(
        JSON.stringify({
          type: 'status',
          connected: status.connected,
          guildId: status.guildId,
        }),
      );
      socket.send(
        JSON.stringify({
          type: 'nowPlaying',
          name: status.nowPlaying,
          guildId: status.guildId,
        }),
      );
    });

    socket.send(
      JSON.stringify({
        type: 'history',
        entries: historyService.serialize(
          discordBot.formatGuildForClient,
          discordBot.getDefaultGuildId(),
        ),
      }),
    );
    socket.send(JSON.stringify({ type: 'volume', value: discordBot.getVolume() }));
  }

  function handlePlayMessage(socket, parsed) {
    const targetGuildId = getTargetGuildId(parsed.guildId);
    if (!targetGuildId) {
      socket.send(JSON.stringify({ type: 'error', message: 'No hay servidores configurados.' }));
      return;
    }

    const session = sessionService.getSession(parsed.token);
    if (!session) {
      socket.send(
        JSON.stringify({ type: 'error', message: 'Debes iniciar sesión con Discord primero.' }),
      );
      return;
    }

    try {
      const sound = discordBot.playSoundByName(parsed.name, targetGuildId);
      const entry = {
        sound,
        at: Date.now(),
        user: discordBot.formatUserForClient(session.user),
        guildId: targetGuildId,
        guildName: discordBot.formatGuildForClient(targetGuildId).name,
      };
      historyService.add(entry);
      broadcast({
        type: 'history',
        entries: historyService.serialize(
          discordBot.formatGuildForClient,
          discordBot.getDefaultGuildId(),
        ),
      });
      socket.send(
        JSON.stringify({
          type: 'ack',
          action: 'play',
          ok: true,
          name: sound,
          user: entry.user,
          at: entry.at,
          guildId: targetGuildId,
          guildName: entry.guildName,
        }),
      );
    } catch (error) {
      socket.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  }

  function handleSetVolume(socket, parsed) {
    const targetGuildId = getTargetGuildId(parsed.guildId);
    if (!targetGuildId) {
      socket.send(JSON.stringify({ type: 'error', message: 'No hay servidores configurados.' }));
      return;
    }
    const session = sessionService.getSession(parsed.token);
    if (!session) {
      socket.send(
        JSON.stringify({ type: 'error', message: 'Debes iniciar sesión con Discord primero.' }),
      );
      return;
    }

    try {
      const nextVolume = discordBot.applyVolume(Number(parsed.value));
      socket.send(
        JSON.stringify({
          type: 'ack',
          action: 'setVolume',
          ok: true,
          value: nextVolume,
          guildId: targetGuildId,
        }),
      );
    } catch (error) {
      socket.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  }

  function handleMessage(socket, message) {
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch (_err) {
      socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload.' }));
      return;
    }

    if (parsed.type === 'play') {
      if (!parsed.name) {
        socket.send(JSON.stringify({ type: 'error', message: 'Missing sound name.' }));
        return;
      }
      handlePlayMessage(socket, parsed);
      return;
    }

    if (parsed.type === 'setVolume') {
      handleSetVolume(socket, parsed);
      return;
    }

    if (parsed.type === 'list') {
      socket.send(JSON.stringify({ type: 'sounds', sounds: soundLibrary.listSounds() }));
      return;
    }

    socket.send(JSON.stringify({ type: 'error', message: 'Unknown message type.' }));
  }

  function start() {
    wss = new WebSocketServer({ port });
    console.log(`WebSocket server listening on ws://localhost:${port}`);

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

      sendInitialState(socket);
      socket.on('message', (data) => handleMessage(socket, data.toString()));
    });
  }

  return {
    start,
    broadcast,
  };
}

module.exports = {
  createWebSocketServer,
};
