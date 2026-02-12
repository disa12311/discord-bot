require('dotenv').config();

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

const mongodbUri = process.env.MONGODB_URI || '';
const inferredMongoTlsDefault = mongodbUri.startsWith('mongodb+srv://');
const hasExplicitMongoTls = process.env.MONGODB_TLS !== undefined && process.env.MONGODB_TLS !== '';

const config = {
  discordToken: process.env.DISCORD_TOKEN || '',
  guildId: process.env.GUILD_ID || '',
  mongodbUri,
  mongodbDb: process.env.MONGODB_DB || 'discord_auth_bot',
  mongodbCollection: process.env.MONGODB_COLLECTION || 'user_vaults',
  mongodbTls: parseBool(process.env.MONGODB_TLS, inferredMongoTlsDefault),
  mongodbTlsExplicit: hasExplicitMongoTls,
  mongodbTlsAllowInvalidCertificates: parseBool(process.env.MONGODB_TLS_ALLOW_INVALID_CERTIFICATES, false),
  mongodbServerSelectionTimeoutMs: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 5000),
  secretEncryptionKeyBase64: process.env.SECRET_ENCRYPTION_KEY_BASE64 || ''
};

module.exports = config;
