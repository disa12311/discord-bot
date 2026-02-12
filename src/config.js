require('dotenv').config();

const config = {
  discordToken: process.env.DISCORD_TOKEN || '',
  guildId: process.env.GUILD_ID || '',
  mongodbUri: process.env.MONGODB_URI || '',
  mongodbDb: process.env.MONGODB_DB || 'discord_auth_bot',
  mongodbCollection: process.env.MONGODB_COLLECTION || 'user_vaults',
  secretEncryptionKeyBase64: process.env.SECRET_ENCRYPTION_KEY_BASE64 || ''
};

module.exports = config;
