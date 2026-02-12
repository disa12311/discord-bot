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

module.exports = {
  normalizeCode,
  normalizeSecret,
  isLikelyBase32,
  isValidCodeFormat,
  isValidLabel
};
