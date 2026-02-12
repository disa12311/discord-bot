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
const GUILD_ID = process.env.GUILD_ID || '';
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'user-secrets.json');

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in environment.');
  process.exit(1);
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
  }
}

function readStore() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeStore(store) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function normalizeCode(input) {
  return String(input || '').trim();
}

function isValidCodeFormat(input) {
  return /^\d{6}$/.test(normalizeCode(input));
}

function normalizeSecret(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '');
}

function isLikelyBase32(input) {
  return /^[A-Z2-7]+=*$/.test(input);
}

function getUserVault(store, userId) {
  const userData = store[userId] || {};

  if (!userData.secrets || typeof userData.secrets !== 'object') {
    userData.secrets = {};
  }

  if (userData.enabledSecret && !userData.secrets.default) {
    userData.secrets.default = userData.enabledSecret;
  }

  store[userId] = userData;
  return userData;
}

function generateTotp(secret) {
  return speakeasy.totp({
    secret,
    encoding: 'base32',
    digits: 6
  });
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
    .setName('auth-code')
    .setDescription('Generate a current 6-digit TOTP code.')
    .addStringOption((option) =>
      option
        .setName('label')
        .setDescription('Saved label to generate code from (example: gmail)')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('secret')
        .setDescription('Optional Base32 secret for one-time code generation')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('auth-save')
    .setDescription('Save a Base32 secret with a label for multi-account management.')
    .addStringOption((option) =>
      option
        .setName('label')
        .setDescription('Name for this secret, e.g. gmail, github, aws')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('secret')
        .setDescription('Base32 secret from authenticator setup')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('auth-list')
    .setDescription('List all saved secret labels.'),
  new SlashCommandBuilder()
    .setName('auth-remove')
    .setDescription('Remove one saved secret by label.')
    .addStringOption((option) =>
      option
        .setName('label')
        .setDescription('Label to remove')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('auth-disable')
    .setDescription('Disable default authenticator after validating a 6-digit code.')
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

  const userData = getUserVault(store, userId);
  userData.tempSecret = secret.base32;
  userData.createdAt = userData.createdAt || new Date().toISOString();
  writeStore(store);

  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);
  const attachmentPath = path.join(DATA_DIR, `${userId}-qr.png`);
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
  const code = normalizeCode(token);

  if (!isValidCodeFormat(code)) {
    await interaction.reply({
      content: '❌ Invalid code format. Please enter exactly 6 digits.',
      ephemeral: true
    });
    return;
  }

  const userId = interaction.user.id;
  const userData = getUserVault(store, userId);

  if (!userData.tempSecret) {
    await interaction.reply({
      content: 'You need to run `/auth-setup` first.',
      ephemeral: true
    });
    return;
  }

  const ok = speakeasy.totp.verify({
    secret: userData.tempSecret,
    encoding: 'base32',
    token: code,
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
  userData.secrets.default = userData.tempSecret;
  userData.tempSecret = null;
  userData.enabledAt = new Date().toISOString();
  writeStore(store);

  await interaction.reply({
    content: '✅ Authenticator enabled successfully. Saved as label `default`.',
    ephemeral: true
  });
}

async function handleStatus(interaction, store) {
  const userId = interaction.user.id;
  const userData = getUserVault(store, userId);
  const enabled = Boolean(userData.enabledSecret);
  const labels = Object.keys(userData.secrets || {});

  await interaction.reply({
    content: enabled
      ? `Your default authenticator is **enabled**. Saved labels: **${labels.length}**.`
      : `Your default authenticator is **disabled**. Saved labels: **${labels.length}**.`,
    ephemeral: true
  });
}

async function handleDisable(interaction, store, token) {
  const code = normalizeCode(token);

  if (!isValidCodeFormat(code)) {
    await interaction.reply({
      content: '❌ Invalid code format. Please enter exactly 6 digits.',
      ephemeral: true
    });
    return;
  }

  const userId = interaction.user.id;
  const userData = getUserVault(store, userId);

  if (!userData.enabledSecret) {
    await interaction.reply({
      content: 'Default authenticator is already disabled.',
      ephemeral: true
    });
    return;
  }

  const ok = speakeasy.totp.verify({
    secret: userData.enabledSecret,
    encoding: 'base32',
    token: code,
    window: 1
  });

  if (!ok) {
    await interaction.reply({
      content: '❌ Invalid authenticator code. Disable request rejected.',
      ephemeral: true
    });
    return;
  }

  userData.tempSecret = null;
  userData.enabledSecret = null;
  userData.disabledAt = new Date().toISOString();
  writeStore(store);

  await interaction.reply({
    content: '✅ Default authenticator disabled (saved labels are still kept).',
    ephemeral: true
  });
}

async function handleCode(interaction, store) {
  const userId = interaction.user.id;
  const userData = getUserVault(store, userId);
  const label = normalizeCode(interaction.options.getString('label', false)).toLowerCase();
  const rawSecret = normalizeSecret(interaction.options.getString('secret', false));

  let secretToUse = '';
  let source = '';

  if (rawSecret) {
    if (!isLikelyBase32(rawSecret)) {
      await interaction.reply({
        content: '❌ Secret không hợp lệ. Hãy nhập Base32 (A-Z và số 2-7).',
        ephemeral: true
      });
      return;
    }

    secretToUse = rawSecret;
    source = 'manual secret';
  } else if (label) {
    secretToUse = userData.secrets[label];
    source = `label \`${label}\``;
  } else {
    secretToUse = userData.secrets.default || userData.enabledSecret;
    source = 'label `default`';
  }

  if (!secretToUse) {
    await interaction.reply({
      content: 'Không tìm thấy secret. Dùng `/auth-save`, hoặc truyền `secret` trực tiếp, hoặc setup mặc định bằng `/auth-setup` + `/auth-verify`.',
      ephemeral: true
    });
    return;
  }

  const code = generateTotp(secretToUse);

  await interaction.reply({
    content: `🔐 Current TOTP code: **${code}** (source: ${source}, valid ~30s).`,
    ephemeral: true
  });
}

async function handleSave(interaction, store) {
  const userId = interaction.user.id;
  const userData = getUserVault(store, userId);
  const label = normalizeCode(interaction.options.getString('label', true)).toLowerCase();
  const secret = normalizeSecret(interaction.options.getString('secret', true));

  if (!/^[a-z0-9_-]{2,32}$/.test(label)) {
    await interaction.reply({
      content: '❌ Label chỉ được chứa chữ thường, số, `_` hoặc `-`, độ dài 2-32.',
      ephemeral: true
    });
    return;
  }

  if (!isLikelyBase32(secret)) {
    await interaction.reply({
      content: '❌ Secret không hợp lệ. Hãy nhập Base32 (A-Z và số 2-7).',
      ephemeral: true
    });
    return;
  }

  userData.secrets[label] = secret;
  writeStore(store);

  await interaction.reply({
    content: `✅ Saved secret with label \`${label}\`. Dùng /auth-code label:${label} để lấy mã 6 số.`,
    ephemeral: true
  });
}

async function handleList(interaction, store) {
  const userId = interaction.user.id;
  const userData = getUserVault(store, userId);
  const labels = Object.keys(userData.secrets || {}).sort();

  if (labels.length === 0) {
    await interaction.reply({
      content: 'Bạn chưa lưu secret nào. Dùng `/auth-save` để thêm.',
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    content: `📋 Saved labels (${labels.length}): ${labels.map((x) => `\`${x}\``).join(', ')}`,
    ephemeral: true
  });
}

async function handleRemove(interaction, store) {
  const userId = interaction.user.id;
  const userData = getUserVault(store, userId);
  const label = normalizeCode(interaction.options.getString('label', true)).toLowerCase();

  if (!userData.secrets[label]) {
    await interaction.reply({
      content: `Không tìm thấy label \`${label}\`.`,
      ephemeral: true
    });
    return;
  }

  delete userData.secrets[label];

  if (label === 'default') {
    userData.enabledSecret = null;
  }

  writeStore(store);

  await interaction.reply({
    content: `🗑️ Đã xóa label \`${label}\`.`,
    ephemeral: true
  });
}

async function registerCommands(client) {
  if (GUILD_ID) {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.commands.set(commands);
    console.log(`Registered slash commands for guild ${GUILD_ID}.`);
    return;
  }

  await client.application.commands.set(commands);
  console.log('Registered slash commands globally (may take a while to appear).');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, async (readyClient) => {
  try {
    console.log(`Logged in as ${readyClient.user.tag}`);
    await registerCommands(readyClient);
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
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

    if (interaction.commandName === 'auth-code') {
      await handleCode(interaction, store);
      return;
    }

    if (interaction.commandName === 'auth-save') {
      await handleSave(interaction, store);
      return;
    }

    if (interaction.commandName === 'auth-list') {
      await handleList(interaction, store);
      return;
    }

    if (interaction.commandName === 'auth-remove') {
      await handleRemove(interaction, store);
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
