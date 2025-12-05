const path = require('path');

require('dotenv').config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const clientSecret = process.env.DISCORD_CLIENT_SECRET;
const legacyGuildId = process.env.DISCORD_GUILD_ID;
const guildIdsEnv = process.env.DISCORD_GUILD_IDS;

const wsPort = Number(process.env.WS_PORT || 3001);
const httpPort = Number(process.env.HTTP_PORT || 3000);
const redirectUri =
  process.env.OAUTH_REDIRECT_URI || `http://localhost:${httpPort}/auth/callback`;

const defaultSoundDir = path.resolve(path.join(__dirname, '..', '..', 'sounds'));
const soundDirs = (process.env.SOUND_DIR || defaultSoundDir)
  .split(',')
  .map((dir) => dir.trim())
  .filter(Boolean)
  .map((dir) => path.resolve(dir));

const historyLimit = Number(process.env.HISTORY_LIMIT);
const DEFAULT_MAX_HISTORY = 200;
const maxHistory =
  Number.isFinite(historyLimit) && historyLimit >= 0 ? historyLimit : DEFAULT_MAX_HISTORY;

const DEFAULT_VOLUME = 0.5;

if (!token || !clientId || !clientSecret) {
  throw new Error('Missing env vars. Require DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_CLIENT_SECRET.');
}

let guildIds = guildIdsEnv
  ? guildIdsEnv
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  : [legacyGuildId].filter(Boolean);

module.exports = {
  discord: {
    token,
    clientId,
    clientSecret,
    guildIds,
    guildIdsEnvProvided: Boolean(guildIdsEnv),
    redirectUri,
  },
  server: {
    wsPort,
    httpPort,
  },
  sound: {
    dirs: soundDirs,
  },
  history: {
    maxHistory,
  },
  volume: {
    defaultVolume: DEFAULT_VOLUME,
  },
};
