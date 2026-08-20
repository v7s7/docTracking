// server/utils/expiry.js
// One definition of how long a session lasts, shared by the login routes that
// mint tokens and the middleware that renews them. Two copies would drift, and
// a mismatch here means sessions that expire earlier than the row says they do.

// The IDLE window, not a hard cap. Sessions slide: any request past the halfway
// point reissues the token (see middleware/authMiddleware.js), so someone using
// the system daily is never signed out. This is how long an ABANDONED session
// survives — long enough not to interrupt normal work, short enough that a
// forgotten login on a shared machine does not stay valid forever.
const DEFAULT_EXPIRY = '30d';

function parseExpiryMs(str) {
  const m = String(str || DEFAULT_EXPIRY).match(/^(\d+)([smhd])$/);
  if (!m) return parseExpiryMs(DEFAULT_EXPIRY);
  return parseInt(m[1], 10) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2]];
}

const parseExpirySeconds = str => Math.floor(parseExpiryMs(str) / 1000);

/** What the running server is actually using, .env included. */
const configuredExpiry = () => process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRY;

module.exports = { DEFAULT_EXPIRY, parseExpiryMs, parseExpirySeconds, configuredExpiry };
