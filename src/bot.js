const { Client, GatewayIntentBits, Events } = require('discord.js');
const config = require('./config');
const { createStorage } = require('./storage');
const { generateTotp } = require('./totp');
const { createSecretCodec } = require('./security');
const { slashCommands, createCommandHandlers } = require('./commands');

if (!config.discordToken) {
  console.error('Missing DISCORD_TOKEN in environment.');
  process.exit(1);
}

const storage = createStorage(config);
const secretCodec = createSecretCodec(config.secretEncryptionKeyBase64);
const handlers = createCommandHandlers({
  writeStore: storage.writeStore,
  generateTotp,
  encryptSecret: secretCodec.encryptSecret,
  decryptSecret: secretCodec.decryptSecret,
  encryptionEnabled: secretCodec.encryptionEnabled
});

async function registerCommands(client) {
  if (config.guildId) {
    const guild = await client.guilds.fetch(config.guildId);
    await guild.commands.set(slashCommands);
    console.log(`Registered slash commands for guild ${config.guildId}.`);
    return;
  }

  await client.application.commands.set(slashCommands);
  console.log('Registered slash commands globally (may take a while to appear).');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (readyClient) => {
  try {
    console.log(`Logged in as ${readyClient.user.tag}`);
    console.log(`Secret encryption: ${secretCodec.encryptionEnabled ? 'enabled' : 'disabled'}.`);
    await storage.initStorage();
    await registerCommands(readyClient);
  } catch (error) {
    console.error('Failed to initialize bot:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    const handler = handlers[interaction.commandName];
    if (!handler) {
      return;
    }

    const store = await storage.readStore();
    await handler(interaction, store);
  } catch (error) {
    console.error('Error handling command:', error);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'Something went wrong while handling your command.', ephemeral: true });
      return;
    }

    await interaction.reply({ content: 'Something went wrong while handling your command.', ephemeral: true });
  }
});

client.login(config.discordToken);
