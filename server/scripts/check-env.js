// server/scripts/check-env.js
//
// Pre-flight for the things that live in .env and the settings table, none of
// which git can see. Prints no secret values — only fingerprints, so it is safe
// to run with someone looking over your shoulder.
//
//   node scripts/check-env.js
const path   = require('path');
const crypto = require('crypto');
const SERVER = path.join(__dirname, '..');
require(path.join(SERVER, 'node_modules', 'dotenv')).config({ path: path.join(SERVER, '.env') });

let emailStatus = null;
try { emailStatus = require(path.join(SERVER, 'services', 'settingsService')).emailStatus; } catch (_) {}

const fp = s => (s ? crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12) : '(unset)');

// The JWT secret disclosed in a chat transcript on 2026-08-20. It is 128 hex
// characters, so a SHA-256 of it cannot be reversed — keeping the fingerprint
// here is safe, and it is the only way to answer "did the rotation actually
// happen?" months from now. The AD password is deliberately NOT fingerprinted:
// it is human-chosen and short enough that a stored hash would be a liability.
const BURNED_JWT_FP = '942215cb7479';

let bad = 0, warn = 0;
const ok   = m => console.log('  ok    ' + m);
const fail = m => { bad++;  console.log('  FAIL  ' + m); };
const soft = m => { warn++; console.log('  warn  ' + m); };

console.log('');

// ── the disclosed secret ────────────────────────────────────────────────────
const secret = process.env.JWT_SECRET;
if (!secret) fail('JWT_SECRET is not set at all');
else if (fp(secret) === BURNED_JWT_FP) {
  fail('JWT_SECRET is STILL THE DISCLOSED ONE (fingerprint ' + BURNED_JWT_FP + ')');
  console.log('        anyone who saw that transcript can forge tokens. Rotate:');
  console.log('        node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
} else if (secret.length < 32) soft('JWT_SECRET is only ' + secret.length + ' characters — use 64 random bytes');
else ok('JWT_SECRET has been rotated (fingerprint ' + fp(secret) + ')');

// ── session lifetime ────────────────────────────────────────────────────────
//
// Two questions, and they used to be answered by two different parsers that
// can disagree: "what does the app THINK the lifetime is" (utils/expiry.js,
// used for the sessions.expires_at column and the sliding-renewal midpoint)
// and "what does jsonwebtoken ACTUALLY mint" (whatever `ms()` makes of the raw
// string, inside jwt.sign — the thing that decides whether a token works).
//
// A bare number with no unit — "8" instead of "8h" — is where they diverge.
// utils/expiry.js's own regex doesn't match it and silently falls back to its
// 30-day default; `ms()` treats the same string as already-in-milliseconds, so
// jwt.sign mints a token that is dead before the HTTP response finishes
// sending. The old version of this check asked only utils/expiry.js and would
// have reported a healthy 30-day window for exactly the value that was locking
// everyone out. It now mints a REAL token the way login actually does and
// measures what came out, so it is reporting the same thing the server does.
const jwt = require(path.join(SERVER, 'node_modules', 'jsonwebtoken'));
const { configuredExpiry } = require(path.join(SERVER, 'utils', 'expiry'));
const life = configuredExpiry();

let actualSeconds = null;
try {
  const probe = jwt.sign({ x: 1 }, 'check-env-probe-secret', { expiresIn: life });
  const { iat, exp } = jwt.decode(probe);
  actualSeconds = exp - iat;
} catch (e) {
  fail(`JWT_EXPIRES_IN=${life} — jsonwebtoken rejects this outright: ${e.message}`);
}

if (actualSeconds !== null) {
  const days = actualSeconds / 86400;
  if (actualSeconds <= 60) {
    fail(`JWT_EXPIRES_IN=${life} mints a token that lives ${actualSeconds}s — everyone is signed out right after logging in.`);
    console.log('        this almost always means a missing unit — use 8h, not 8. See index.js\'s startup check.');
  } else if (days < 1) {
    fail(`JWT_EXPIRES_IN=${life} — people are signed out after ${(days * 24).toFixed(1)}h idle. Sliding sessions cannot help overnight.`);
  } else {
    ok(`JWT_EXPIRES_IN=${life} (idle window ${days.toFixed(days % 1 ? 1 : 0)} day${days === 1 ? '' : 's'}, confirmed by actually signing a token)`);
  }
}

// ── URLs that end up in emails ──────────────────────────────────────────────
for (const k of ['APP_URL', 'CLIENT_URL']) {
  const v = process.env[k];
  if (!v) soft(k + ' is unset — email links will have no destination');
  else if (/localhost|127\.0\.0\.1/.test(v)) fail(k + '=' + v + ' — nobody else can open that link');
  else ok(k + '=' + v);
}

// ── LDAP ────────────────────────────────────────────────────────────────────
const bindDn = process.env.LDAP_BIND_DN || '';
if (!bindDn) soft('LDAP_BIND_DN unset — the AD user browser is disabled');
else {
  ok('LDAP_BIND_DN=' + bindDn + '  (password fingerprint ' + fp(process.env.LDAP_BIND_PASSWORD) + ')');
  const overrides = (process.env.SUPER_ADMIN_USERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const who = bindDn.split('@')[0].toLowerCase();
  if (overrides.includes(who) || overrides.includes(bindDn.toLowerCase())) {
    fail('the bind account is ALSO in SUPER_ADMIN_USERS — one leaked string is full app admin');
    console.log('        authenticateUser binds with whatever password is typed, so that');
    console.log('        credential is a working login. Use a dedicated service account.');
  }
}
if ((process.env.LDAP_URL || '').startsWith('ldap://')) {
  soft('LDAP_URL is plaintext ldap:// — every password crosses the wire in the clear');
}

// ── mail ────────────────────────────────────────────────────────────────────
if (!process.env.SMTP_HOST) soft('SMTP_HOST unset — no mail can be sent regardless of the switch');
else ok('SMTP_HOST=' + process.env.SMTP_HOST + ':' + (process.env.SMTP_PORT || 25));

try {
  if (!emailStatus) throw new Error('settings service unavailable');
  const s = emailStatus();
  console.log('  ' + (s.enabled ? 'ok    ' : 'warn  ') + 'email switch is ' + (s.enabled ? 'ON' : 'OFF')
    + (s.updated_by ? ' (set by ' + s.updated_by + ' at ' + s.updated_at + ')' : ' (default)'));
  if (!s.enabled) warn++;
} catch (e) { soft('could not read the email switch: ' + e.message); }

console.log('');
console.log(bad ? '  >> ' + bad + ' thing(s) still need fixing' + (warn ? ', ' + warn + ' worth a look' : '')
                : warn ? '  >> nothing broken, ' + warn + ' worth a look'
                       : '  >> all clear');
console.log('');
process.exit(bad ? 1 : 0);
