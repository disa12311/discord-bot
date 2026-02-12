const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  Events
} = require('discord.js');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
require('dotenv').config();

const ISSUER = process.env.AUTH_ISSUER || 'DiscordAuthenticator';
const DATA_FILE = path.join(__dirname, '..', 'data', 'user-secrets.json');

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in environment.');
  process.exit(1);
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
  }
}

function readStore() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

const commands = [
  new SlashCommandBuilder()
    .setName('auth-setup')
    .setDescription('Create a new authenticator secret and receive a QR code in DM.'),
  new SlashCommandBuilder()
    .setName('auth-verify')
    .setDescription('Verify and enable your authenticator with a 6-digit code.')
    .addStringOption((option) =>
      option
        .setName('code')
        .setDescription('6-digit code from your authenticator app')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('auth-status')
    .setDescription('Show whether your authenticator is enabled.'),
  new SlashCommandBuilder()
    .setName('auth-disable')
    .setDescription('Disable authenticator after validating a 6-digit code.')
    .addStringOption((option) =>
      option
        .setName('code')
        .setDescription('6-digit code from your authenticator app')
        .setRequired(true)
    )
].map((c) => c.toJSON());

async function handleSetup(interaction, store) {
  const userId = interaction.user.id;
  const accountLabel = `${ISSUER}:${interaction.user.username}`;

  const secret = speakeasy.generateSecret({
    name: accountLabel,
    issuer: ISSUER,
    length: 32
  });

  store[userId] = {
    tempSecret: secret.base32,
    enabledSecret: null,
    createdAt: new Date().toISOString()
  };
  writeStore(store);

  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);
  const attachmentPath = path.join(__dirname, '..', 'data', `${userId}-qr.png`);
  const base64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(attachmentPath, Buffer.from(base64, 'base64'));

  const dmEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Authenticator setup')
    .setDescription(
      [
        'Scan the QR code with Google Authenticator, Authy, or any TOTP app.',
        `If QR fails, use this secret manually: \`${secret.base32}\``,
        'Then run `/auth-verify` in server with your code.'
      ].join('\n')
    )
    .setImage(`attachment://${userId}-qr.png`)
    .setTimestamp();

  try {
    await interaction.user.send({
      embeds: [dmEmbed],
      files: [{ attachment: attachmentPath, name: `${userId}-qr.png` }]
    });

    await interaction.reply({
      content: '✅ I sent setup instructions to your DM.',
      ephemeral: true
    });
  } catch (error) {
    await interaction.reply({
      content: '❌ I could not DM you. Please enable DMs from server members and try again.',
      ephemeral: true
    });
  } finally {
    if (fs.existsSync(attachmentPath)) {
      fs.unlinkSync(attachmentPath);
    }
  }
}

async function handleVerify(interaction, store, token) {
  const userId = interaction.user.id;
  const userData = store[userId];

  if (!userData || !userData.tempSecret) {
    await interaction.reply({
      content: 'You need to run `/auth-setup` first.',
      ephemeral: true
    });
    return;
  }

  const ok = speakeasy.totp.verify({
    secret: userData.tempSecret,
    encoding: 'base32',
    token,
    window: 1
  });

  if (!ok) {
    await interaction.reply({
      content: '❌ Invalid authenticator code. Please try again.',
      ephemeral: true
    });
    return;
  }

  userData.enabledSecret = userData.tempSecret;
  userData.tempSecret = null;
  userData.enabledAt = new Date().toISOString();
  store[userId] = userData;
  writeStore(store);

  await interaction.reply({
    content: '✅ Authenticator enabled successfully.',
    ephemeral: true
  });
}

async function handleStatus(interaction, store) {
  const userId = interaction.user.id;
  const userData = store[userId];
  const enabled = Boolean(userData && userData.enabledSecret);

  await interaction.reply({
    content: enabled
      ? 'Your authenticator is currently **enabled**.'
      : 'Your authenticator is currently **disabled**.',
    ephemeral: true
  });
}

async function handleDisable(interaction, store, token) {
  const userId = interaction.user.id;
  const userData = store[userId];

  if (!userData || !userData.enabledSecret) {
    await interaction.reply({
      content: 'Authenticator is already disabled.',
      ephemeral: true
    });
    return;
  }

  const ok = speakeasy.totp.verify({
    secret: userData.enabledSecret,
    encoding: 'base32',
    token,
    window: 1
  });

  if (!ok) {
    await interaction.reply({
      content: '❌ Invalid authenticator code. Disable request rejected.',
      ephemeral: true
    });
    return;
  }

  store[userId] = {
    tempSecret: null,
    enabledSecret: null,
    disabledAt: new Date().toISOString()
  };
  writeStore(store);

  await interaction.reply({
    content: '✅ Authenticator disabled.',
    ephemeral: true
  });
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  await readyClient.application.commands.set(commands);
  console.log('Registered slash commands globally.');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  const store = readStore();

  try {
    if (interaction.commandName === 'auth-setup') {
      await handleSetup(interaction, store);
      return;
    }

    if (interaction.commandName === 'auth-verify') {
      await handleVerify(interaction, store, interaction.options.getString('code', true));
      return;
    }

    if (interaction.commandName === 'auth-status') {
      await handleStatus(interaction, store);
      return;
    }

    if (interaction.commandName === 'auth-disable') {
      await handleDisable(interaction, store, interaction.options.getString('code', true));
    }
  } catch (error) {
    console.error('Error handling command:', error);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: 'Something went wrong while handling your command.',
        ephemeral: true
      });
      return;
    }

    await interaction.reply({
      content: 'Something went wrong while handling your command.',
      ephemeral: true
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
