const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Events
} = require('discord.js');
const { authenticator } = require('otplib');
require('dotenv').config();

const GUILD_ID = process.env.GUILD_ID || '';
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'user-secrets.json');


authenticator.options = {
  digits: 6,
  step: 30,
  window: 1
};

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

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    const backup = `${DATA_FILE}.broken.${Date.now()}`;

    try {
      fs.copyFileSync(DATA_FILE, backup);
    } catch (copyError) {
      console.error('Failed to backup broken store file:', copyError);
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
    console.error('Store file was corrupted. Reinitialized empty store. Backup:', backup);
    return {};
  }
}

function writeStore(store) {
  ensureDataFile();
  const tempPath = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2));
  fs.renameSync(tempPath, DATA_FILE);
}

function normalizeCode(input) {
  return String(input || '').trim();
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

function isValidCodeFormat(input) {
  return /^\d{6}$/.test(normalizeCode(input));
}

function isValidLabel(input) {
  return /^[a-z0-9_-]{2,32}$/.test(input);
}

function getUserVault(store, userId) {
  const userData = store[userId] || {};

  if (!userData.secrets || typeof userData.secrets !== 'object') {
    userData.secrets = {};
  }

  store[userId] = userData;
  return userData;
}

function generateTotp(secret) {
  return authenticator.generate(secret);
}

const commands = [
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
    .setName('auth-set-default')
    .setDescription('Set one saved label as default for /auth-code.')
    .addStringOption((option) =>
      option
        .setName('label')
        .setDescription('Label to mark as default')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('auth-status')
    .setDescription('Show vault status and default label.')
].map((c) => c.toJSON());

async function handleSave(interaction, store) {
  const userId = interaction.user.id;
  const userData = getUserVault(store, userId);
  const label = normalizeCode(interaction.options.getString('label', true)).toLowerCase();
  const secret = normalizeSecret(interaction.options.getString('secret', true));

  if (!isValidLabel(label)) {
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

  try {
    generateTotp(secret);
  } catch (error) {
    await interaction.reply({
      content: '❌ Secret không hợp lệ hoặc không thể tạo mã TOTP.',
      ephemeral: true
    });
    return;
  }

  userData.secrets[label] = secret;

  if (!userData.defaultLabel) {
    userData.defaultLabel = label;
  }

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

  const defaultLabel = userData.defaultLabel ? ` (default: \`${userData.defaultLabel}\`)` : '';

  await interaction.reply({
    content: `📋 Saved labels (${labels.length})${defaultLabel}: ${labels.map((x) => `\`${x}\``).join(', ')}`,
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

  if (userData.defaultLabel === label) {
    const rest = Object.keys(userData.secrets);
    userData.defaultLabel = rest[0] || null;
  }

  writeStore(store);

  await interaction.reply({
    content: `🗑️ Đã xóa label \`${label}\`.`,
    ephemeral: true
  });
}

async function handleSetDefault(interaction, store) {
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

  userData.defaultLabel = label;
  writeStore(store);

  await interaction.reply({
    content: `✅ Default label đã đặt thành \`${label}\`.`,
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

    try {
      generateTotp(rawSecret);
    } catch (error) {
      await interaction.reply({
        content: '❌ Secret nhập tay không hợp lệ cho TOTP.',
        ephemeral: true
      });
      return;
    }

    secretToUse = rawSecret;
    source = 'manual secret';
  } else if (label) {
    secretToUse = userData.secrets[label];
    source = `label \`${label}\``;
  } else if (userData.defaultLabel) {
    secretToUse = userData.secrets[userData.defaultLabel];
    source = `default label \`${userData.defaultLabel}\``;
  }

  if (!secretToUse) {
    await interaction.reply({
      content: 'Không tìm thấy secret. Dùng `/auth-save`, hoặc truyền `secret` trực tiếp, hoặc đặt default bằng `/auth-set-default`.',
      ephemeral: true
    });
    return;
  }

  const code = generateTotp(secretToUse);

  if (!isValidCodeFormat(code)) {
    await interaction.reply({
      content: '❌ Không thể tạo mã 6 chữ số từ secret hiện tại.',
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    content: `🔐 Current TOTP code: **${code}** (source: ${source}, valid ~30s).`,
    ephemeral: true
  });
}

async function handleStatus(interaction, store) {
  const userId = interaction.user.id;
  const userData = getUserVault(store, userId);
  const labels = Object.keys(userData.secrets || {});

  await interaction.reply({
    content: `Vault status: **${labels.length}** labels saved.${userData.defaultLabel ? ` Default: \`${userData.defaultLabel}\`.` : ' No default set.'}`,
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

    if (interaction.commandName === 'auth-set-default') {
      await handleSetDefault(interaction, store);
      return;
    }

    if (interaction.commandName === 'auth-code') {
      await handleCode(interaction, store);
      return;
    }

    if (interaction.commandName === 'auth-status') {
      await handleStatus(interaction, store);
      return;
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
