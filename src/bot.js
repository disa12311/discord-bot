const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
require('dotenv').config();

const PREFIX = process.env.BOT_PREFIX || '!auth';
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

function getHelpText() {
  return [
    `\`${PREFIX} setup\` - Create a new authenticator secret and receive a QR code in DM.`,
    `\`${PREFIX} verify <6-digit-code>\` - Verify and enable 2FA for your user.`,
    `\`${PREFIX} status\` - Show whether your authenticator is enabled.`,
    `\`${PREFIX} disable <6-digit-code>\` - Disable authenticator after code verification.`
  ].join('\n');
}

async function handleSetup(message, store) {
  const userId = message.author.id;
  const accountLabel = `${ISSUER}:${message.author.username}`;

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
        `Then verify in server with: \`${PREFIX} verify <code>\``
      ].join('\n')
    )
    .setImage(`attachment://${userId}-qr.png`)
    .setTimestamp();

  try {
    await message.author.send({
      embeds: [dmEmbed],
      files: [{ attachment: attachmentPath, name: `${userId}-qr.png` }]
    });

    await message.reply('✅ I sent setup instructions to your DM.');
  } catch (error) {
    await message.reply('❌ I could not DM you. Please enable DMs from server members and try again.');
  } finally {
    if (fs.existsSync(attachmentPath)) {
      fs.unlinkSync(attachmentPath);
    }
  }
}

async function handleVerify(message, store, token) {
  const userId = message.author.id;
  const userData = store[userId];

  if (!userData || !userData.tempSecret) {
    await message.reply(`You need to run \`${PREFIX} setup\` first.`);
    return;
  }

  const ok = speakeasy.totp.verify({
    secret: userData.tempSecret,
    encoding: 'base32',
    token,
    window: 1
  });

  if (!ok) {
    await message.reply('❌ Invalid authenticator code. Please try again.');
    return;
  }

  userData.enabledSecret = userData.tempSecret;
  userData.tempSecret = null;
  userData.enabledAt = new Date().toISOString();
  store[userId] = userData;
  writeStore(store);

  await message.reply('✅ Authenticator enabled successfully.');
}

async function handleStatus(message, store) {
  const userId = message.author.id;
  const userData = store[userId];
  const enabled = Boolean(userData && userData.enabledSecret);

  if (!enabled) {
    await message.reply('Your authenticator is currently **disabled**.');
    return;
  }

  await message.reply('Your authenticator is currently **enabled**.');
}

async function handleDisable(message, store, token) {
  const userId = message.author.id;
  const userData = store[userId];

  if (!userData || !userData.enabledSecret) {
    await message.reply('Authenticator is already disabled.');
    return;
  }

  const ok = speakeasy.totp.verify({
    secret: userData.enabledSecret,
    encoding: 'base32',
    token,
    window: 1
  });

  if (!ok) {
    await message.reply('❌ Invalid authenticator code. Disable request rejected.');
    return;
  }

  store[userId] = {
    tempSecret: null,
    enabledSecret: null,
    disabledAt: new Date().toISOString()
  };
  writeStore(store);

  await message.reply('✅ Authenticator disabled.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) {
    return;
  }

  const store = readStore();
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = (args.shift() || '').toLowerCase();

  try {
    if (!command || command === 'help') {
      await message.reply(getHelpText());
      return;
    }

    if (command === 'setup') {
      await handleSetup(message, store);
      return;
    }

    if (command === 'verify') {
      if (!args[0]) {
        await message.reply(`Usage: \`${PREFIX} verify <6-digit-code>\``);
        return;
      }
      await handleVerify(message, store, args[0]);
      return;
    }

    if (command === 'status') {
      await handleStatus(message, store);
      return;
    }

    if (command === 'disable') {
      if (!args[0]) {
        await message.reply(`Usage: \`${PREFIX} disable <6-digit-code>\``);
        return;
      }
      await handleDisable(message, store, args[0]);
      return;
    }

    await message.reply(`Unknown command.\n${getHelpText()}`);
  } catch (error) {
    console.error('Error handling command:', error);
    await message.reply('Something went wrong while handling your command.');
  }
});

client.login(process.env.DISCORD_TOKEN);
