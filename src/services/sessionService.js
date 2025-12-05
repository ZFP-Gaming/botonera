const crypto = require('crypto');
const { formatUserForClient } = require('../utils/formatters');

function createSessionService(clientSecret) {
  function signSession(user) {
    const safeUser = formatUserForClient(user);
    const payload = JSON.stringify({ user: safeUser, iat: Date.now() });
    const base = Buffer.from(payload).toString('base64url');
    const sig = crypto.createHmac('sha256', clientSecret).update(base).digest('base64url');
    return `${base}.${sig}`;
  }

  function getSession(token) {
    if (!token) return null;
    const [base, sig] = token.split('.');
    if (!base || !sig) return null;
    const expected = crypto.createHmac('sha256', clientSecret).update(base).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) {
      return null;
    }
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    try {
      const parsed = JSON.parse(Buffer.from(base, 'base64url').toString('utf8'));
      return { user: parsed.user, createdAt: parsed.iat };
    } catch (_err) {
      return null;
    }
  }

  return {
    signSession,
    getSession,
  };
}

module.exports = {
  createSessionService,
};
