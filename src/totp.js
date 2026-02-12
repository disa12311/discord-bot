const { authenticator } = require('otplib');

authenticator.options = {
  digits: 6,
  step: 30,
  window: 1
};

function generateTotp(secret) {
  return authenticator.generate(secret);
}

module.exports = {
  generateTotp
};
