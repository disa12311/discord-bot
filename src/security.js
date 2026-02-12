const crypto = require('node:crypto');

const PREFIX = 'enc:v1';

function createSecretCodec(base64Key) {
  let key = null;

  if (base64Key) {
    try {
      const parsed = Buffer.from(base64Key, 'base64');
      if (parsed.length === 64) {
        key = crypto.createHash('sha256').update(parsed).digest();
      } else {
        console.error('SECRET_ENCRYPTION_KEY_BASE64 must decode to exactly 64 bytes.');
      }
    } catch (error) {
      console.error('Invalid SECRET_ENCRYPTION_KEY_BASE64 format:', error.message);
    }
  }

  function isEncryptedPayload(value) {
    return typeof value === 'string' && value.startsWith(`${PREFIX}:`);
  }

  function encryptSecret(plainText) {
    if (!key) {
      return plainText;
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const cipherText = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${cipherText.toString('base64')}`;
  }

  function decryptSecret(value) {
    if (!isEncryptedPayload(value)) {
      return value;
    }

    if (!key) {
      throw new Error('Secret is encrypted but SECRET_ENCRYPTION_KEY_BASE64 is missing.');
    }

    const parts = value.split(':');
    if (parts.length !== 5) {
      throw new Error('Invalid encrypted payload format.');
    }

    const iv = Buffer.from(parts[2], 'base64');
    const tag = Buffer.from(parts[3], 'base64');
    const cipherText = Buffer.from(parts[4], 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
  }

  return {
    encryptionEnabled: Boolean(key),
    encryptSecret,
    decryptSecret,
    isEncryptedPayload
  };
}

module.exports = {
  createSecretCodec
};
