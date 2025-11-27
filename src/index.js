require('dotenv').config();

if (typeof ReadableStream === 'undefined') {
  const { ReadableStream } = require('stream/web');
  global.ReadableStream = ReadableStream;
}

const fs = require('fs');
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
const soundDir = path.resolve(process.env.SOUND_DIR || path.join(__dirname, '..', 'sounds'));

if (!token || !clientId || !guildId) {
  throw new Error('Missing env vars DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID.');
}

const audioPlayer = createAudioPlayer({
  behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
});
let nowPlaying = null;
let wss;

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
    return fs
      .readdirSync(soundDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /\.(mp3|wav|ogg|flac)$/i.test(name))
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    console.error('Error reading sounds directory:', error);
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
  const filePath = path.join(soundDir, safeName);
  if (!filePath.startsWith(soundDir)) {
    throw new Error('Invalid sound name.');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error('Sound not found.');
  }

  const resource = createAudioResource(filePath);
  connection.subscribe(audioPlayer);
  nowPlaying = safeName;
  audioPlayer.play(resource);
  broadcast({ type: 'nowPlaying', name: nowPlaying });
  return safeName;
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
    try {
      const sound = playSoundByName(parsed.name);
      socket.send(JSON.stringify({ type: 'ack', action: 'play', ok: true, name: sound }));
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

  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'sounds', sounds: listSounds() }));
    socket.send(
      JSON.stringify({
        type: 'status',
        connected: Boolean(getVoiceConnection(guildId)),
      }),
    );
    socket.send(JSON.stringify({ type: 'nowPlaying', name: nowPlaying }));

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

async function start() {
  await registerCommands();
  startWebSocketServer();
  await client.login(token);
}

start().catch((error) => {
  console.error('Bot failed to start:', error);
  process.exit(1);
});
