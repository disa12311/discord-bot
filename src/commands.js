const { SlashCommandBuilder } = require('discord.js');
const {
  normalizeCode,
  normalizeSecret,
  isLikelyBase32,
  isValidCodeFormat,
  isValidLabel
} = require('./validators');

function getUserVault(store, userId) {
  const userData = store[userId] || {};

  if (!userData.secrets || typeof userData.secrets !== 'object') {
    userData.secrets = {};
  }

  store[userId] = userData;
  return userData;
}

const slashCommands = [
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
  new SlashCommandBuilder().setName('auth-list').setDescription('List all saved secret labels.'),
  new SlashCommandBuilder()
    .setName('auth-remove')
    .setDescription('Remove one saved secret by label.')
    .addStringOption((option) => option.setName('label').setDescription('Label to remove').setRequired(true)),
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
    .addStringOption((option) => option.setName('label').setDescription('Label to mark as default').setRequired(true)),
  new SlashCommandBuilder().setName('auth-status').setDescription('Show vault status and default label.')
].map((c) => c.toJSON());

function createCommandHandlers({ writeStore, generateTotp, encryptSecret, decryptSecret, encryptionEnabled }) {
  async function handleSave(interaction, store) {
    const userId = interaction.user.id;
    const userData = getUserVault(store, userId);
    const label = normalizeCode(interaction.options.getString('label', true)).toLowerCase();
    const secret = normalizeSecret(interaction.options.getString('secret', true));

    if (!isValidLabel(label)) {
      await interaction.reply({ content: '❌ Label chỉ được chứa chữ thường, số, `_` hoặc `-`, độ dài 2-32.', ephemeral: true });
      return;
    }

    if (!isLikelyBase32(secret)) {
      await interaction.reply({ content: '❌ Secret không hợp lệ. Hãy nhập Base32 (A-Z và số 2-7).', ephemeral: true });
      return;
    }

    try {
      generateTotp(secret);
    } catch {
      await interaction.reply({ content: '❌ Secret không hợp lệ hoặc không thể tạo mã TOTP.', ephemeral: true });
      return;
    }

    userData.secrets[label] = encryptSecret(secret);
    if (!userData.defaultLabel) {
      userData.defaultLabel = label;
    }

    await writeStore(store);

    await interaction.reply({
      content: `✅ Saved secret with label \`${label}\`${encryptionEnabled ? ' (encrypted/base64).' : ''}. Dùng /auth-code label:${label} để lấy mã 6 số.`,
      ephemeral: true
    });
  }

  async function handleList(interaction, store) {
    const userId = interaction.user.id;
    const userData = getUserVault(store, userId);
    const labels = Object.keys(userData.secrets || {}).sort();

    if (labels.length === 0) {
      await interaction.reply({ content: 'Bạn chưa lưu secret nào. Dùng `/auth-save` để thêm.', ephemeral: true });
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
      await interaction.reply({ content: `Không tìm thấy label \`${label}\`.`, ephemeral: true });
      return;
    }

    delete userData.secrets[label];

    if (userData.defaultLabel === label) {
      const rest = Object.keys(userData.secrets);
      userData.defaultLabel = rest[0] || null;
    }

    await writeStore(store);
    await interaction.reply({ content: `🗑️ Đã xóa label \`${label}\`.`, ephemeral: true });
  }

  async function handleSetDefault(interaction, store) {
    const userId = interaction.user.id;
    const userData = getUserVault(store, userId);
    const label = normalizeCode(interaction.options.getString('label', true)).toLowerCase();

    if (!userData.secrets[label]) {
      await interaction.reply({ content: `Không tìm thấy label \`${label}\`.`, ephemeral: true });
      return;
    }

    userData.defaultLabel = label;
    await writeStore(store);
    await interaction.reply({ content: `✅ Default label đã đặt thành \`${label}\`.`, ephemeral: true });
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
        await interaction.reply({ content: '❌ Secret không hợp lệ. Hãy nhập Base32 (A-Z và số 2-7).', ephemeral: true });
        return;
      }

      try {
        generateTotp(rawSecret);
      } catch {
        await interaction.reply({ content: '❌ Secret nhập tay không hợp lệ cho TOTP.', ephemeral: true });
        return;
      }

      secretToUse = rawSecret;
      source = 'manual secret';
    } else if (label) {
      source = `label \`${label}\``;
      try {
        secretToUse = decryptSecret(userData.secrets[label]);
      } catch {
        await interaction.reply({ content: '❌ Không thể giải mã secret. Kiểm tra SECRET_ENCRYPTION_KEY_BASE64.', ephemeral: true });
        return;
      }
    } else if (userData.defaultLabel) {
      source = `default label \`${userData.defaultLabel}\``;
      try {
        secretToUse = decryptSecret(userData.secrets[userData.defaultLabel]);
      } catch {
        await interaction.reply({ content: '❌ Không thể giải mã secret mặc định. Kiểm tra SECRET_ENCRYPTION_KEY_BASE64.', ephemeral: true });
        return;
      }
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
      await interaction.reply({ content: '❌ Không thể tạo mã 6 chữ số từ secret hiện tại.', ephemeral: true });
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
      content: `Vault status: **${labels.length}** labels saved.${userData.defaultLabel ? ` Default: \`${userData.defaultLabel}\`.` : ' No default set.'}${encryptionEnabled ? ' Encryption: **ON**.' : ' Encryption: **OFF**.'}`,
      ephemeral: true
    });
  }

  return {
    'auth-save': handleSave,
    'auth-list': handleList,
    'auth-remove': handleRemove,
    'auth-set-default': handleSetDefault,
    'auth-code': handleCode,
    'auth-status': handleStatus
  };
}

module.exports = {
  slashCommands,
  createCommandHandlers
};
