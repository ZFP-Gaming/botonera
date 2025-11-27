require('dotenv').config();
const { Client, Events, GatewayIntentBits, REST, Routes } = require('discord.js');
const {
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
} = require('@discordjs/voice');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  throw new Error('Missing env vars DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID.');
}

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
    await interaction.reply({
      content: 'Left the voice channel.',
      ephemeral: true,
    });
  }
});

async function start() {
  await client.login(token);
  await registerCommands();
}

start().catch((error) => {
  console.error('Bot failed to start:', error);
  process.exit(1);
});
