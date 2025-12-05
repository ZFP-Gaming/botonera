const EventEmitter = require('events');
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
const { formatGuildForClient, formatUserForClient } = require('../utils/formatters');

function createDiscordBot(config, soundLibrary) {
  const emitter = new EventEmitter();
  const audioPlayersByGuild = new Map();
  const nowPlayingByGuild = new Map();
  let volume = config.volume.defaultVolume;
  let guildIds = [...config.discord.guildIds];
  let allowedGuildIds = new Set(guildIds);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  const rest = new REST({ version: '10' }).setToken(config.discord.token);

  function emit(event, payload) {
    emitter.emit(event, payload);
  }

  function getDefaultGuildId() {
    return guildIds[0];
  }

  function getAllowedGuildIds() {
    return Array.from(allowedGuildIds);
  }

  function refreshGuildsFromClient() {
    if (config.discord.guildIdsEnvProvided) return;
    const cachedIds = Array.from(client.guilds.cache.values()).map((g) => g.id);
    if (!cachedIds.length) {
      console.warn('No guilds found in cache to register commands.');
      return;
    }
    guildIds = cachedIds;
    allowedGuildIds = new Set(guildIds);
    emit('guilds', listGuildsForClient());
  }

  async function registerCommands() {
    if (!guildIds.length) {
      console.warn('No guild IDs available for command registration.');
      return;
    }

    await Promise.all(
      guildIds.map((id) =>
        rest
          .put(Routes.applicationGuildCommands(config.discord.clientId, id), {
            body: [
              {
                name: 'join',
                description: 'Join your current voice channel',
              },
              {
                name: 'leave',
                description: 'Leave the current voice channel',
              },
            ],
          })
          .then(() => {
            console.log('Slash commands registered for guild', id);
          })
          .catch((error) => {
            console.error(`Failed to register commands for guild ${id}:`, error);
          }),
      ),
    );
  }

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
    refreshGuildsFromClient();
    await registerCommands();
    emit('guilds', listGuildsForClient());
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!allowedGuildIds.has(interaction.guildId)) {
      await interaction.reply({
        content: 'Este bot no está configurado para este servidor.',
        ephemeral: true,
      });
      return;
    }
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
        emit('status', {
          connected: true,
          channel: memberChannel.name,
          guildId: interaction.guildId,
        });
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
      const player = audioPlayersByGuild.get(interaction.guild.id);
      if (player) {
        player.stop(true);
      }
      await interaction.reply({
        content: 'Left the voice channel.',
        ephemeral: true,
      });
      nowPlayingByGuild.set(interaction.guildId, null);
      emit('status', { connected: false, guildId: interaction.guildId });
      emit('nowPlaying', { name: null, guildId: interaction.guildId });
    }
  });

  function getOrCreateAudioPlayer(guildId) {
    if (audioPlayersByGuild.has(guildId)) {
      return audioPlayersByGuild.get(guildId);
    }
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    player.on(AudioPlayerStatus.Playing, () => {
      emit('nowPlaying', {
        name: nowPlayingByGuild.get(guildId) || null,
        guildId,
      });
    });

    player.on(AudioPlayerStatus.Idle, () => {
      nowPlayingByGuild.set(guildId, null);
      emit('nowPlaying', { name: null, guildId });
    });

    player.on('error', (error) => {
      console.error(`Audio player error for guild ${guildId}:`, error);
      emit('error', { message: 'Audio playback failed.' });
    });

    audioPlayersByGuild.set(guildId, player);
    return player;
  }

  function playSoundByName(name, targetGuildId) {
    const fallbackGuild = getDefaultGuildId();
    if (!fallbackGuild) {
      throw new Error('Bot is not configured for ningún servidor de Discord.');
    }
    const safeGuildId = allowedGuildIds.has(targetGuildId) ? targetGuildId : fallbackGuild;
    const connection = getVoiceConnection(safeGuildId);
    if (!connection) {
      throw new Error('Bot is not connected to a voice channel. Use /join first.');
    }

    const resolved = soundLibrary.resolveSoundByName(name);
    if (!resolved) {
      throw new Error('Sound not found.');
    }

    const player = getOrCreateAudioPlayer(safeGuildId);
    const resource = createAudioResource(resolved.path, { inlineVolume: true });
    if (resource.volume) {
      resource.volume.setVolume(volume);
    }
    connection.subscribe(player);
    nowPlayingByGuild.set(safeGuildId, resolved.name);
    player.play(resource);
    emit('nowPlaying', { name: resolved.name, guildId: safeGuildId });
    return resolved.name;
  }

  function clampVolume(value) {
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(1, value));
  }

  function applyVolume(newVolume) {
    const safeVolume = clampVolume(newVolume);
    if (safeVolume === null) {
      throw new Error('Invalid volume value.');
    }
    volume = safeVolume;
    audioPlayersByGuild.forEach((player) => {
      const resource = player.state?.resource;
      if (resource?.volume?.setVolume) {
        resource.volume.setVolume(volume);
      }
    });
    emit('volume', { value: volume });
    return volume;
  }

  function listGuildsForClient() {
    return getAllowedGuildIds().map((id) => formatGuildForClient(id, client));
  }

  function getStatusSnapshot() {
    return getAllowedGuildIds().map((id) => ({
      guildId: id,
      connected: Boolean(getVoiceConnection(id)),
      nowPlaying: nowPlayingByGuild.get(id) || null,
    }));
  }

  async function start() {
    await client.login(config.discord.token);
  }

  return {
    start,
    on: (...args) => emitter.on(...args),
    off: (...args) => emitter.off(...args),
    emit,
    listGuildsForClient,
    getDefaultGuildId,
    playSoundByName,
    applyVolume,
    getVolume: () => volume,
    getAllowedGuildIds,
    getStatusSnapshot,
    getNowPlaying: (guildId) => nowPlayingByGuild.get(guildId) || null,
    getVoiceConnectionForGuild: (guildId) => getVoiceConnection(guildId),
    formatUserForClient,
    formatGuildForClient: (id) => formatGuildForClient(id, client),
  };
}

module.exports = {
  createDiscordBot,
};
