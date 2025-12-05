const config = require('./config/config');
const { createSoundLibrary } = require('./services/soundLibrary');
const { createSessionService } = require('./services/sessionService');
const { createHistoryService } = require('./services/historyService');
const { createDiscordBot } = require('./services/discordBot');
const { createWebSocketServer } = require('./transports/websocketServer');
const { startHttpServer } = require('./transports/httpServer');

async function start() {
  const soundLibrary = createSoundLibrary(config.sound.dirs);
  const sessionService = createSessionService(config.discord.clientSecret);
  const historyService = createHistoryService(config.history.maxHistory);

  const discordBot = createDiscordBot(config, soundLibrary);
  const wsServer = createWebSocketServer({
    port: config.server.wsPort,
    soundLibrary,
    discordBot,
    sessionService,
    historyService,
  });

  // Wire Discord domain events to the websocket broadcast layer.
  discordBot.on('guilds', (guilds) => wsServer.broadcast({ type: 'guilds', guilds }));
  discordBot.on('status', (payload) => wsServer.broadcast({ type: 'status', ...payload }));
  discordBot.on('nowPlaying', (payload) => wsServer.broadcast({ type: 'nowPlaying', ...payload }));
  discordBot.on('volume', (payload) => wsServer.broadcast({ type: 'volume', value: payload.value }));
  discordBot.on('error', (payload) => wsServer.broadcast({ type: 'error', message: payload.message }));

  startHttpServer({
    config,
    sessionService,
    formatUserForClient: discordBot.formatUserForClient,
  });

  wsServer.start();
  await discordBot.start();
}

start().catch((error) => {
  console.error('Bot failed to start:', error);
  process.exit(1);
});
