// server/services/ldapService.js
const { getLdapConfig, createLdapClient } = require('../config/ldap');

// Attempt to bind with a given DN + password.
// Returns the connected (and bound) client on success.
function bindClient(client, dn, password) {
  return new Promise((resolve, reject) => {
    client.bind(dn, password, (err) => {
      if (err) {
        client.unbind(() => {});
        return reject(err);
      }
      resolve(client);
    });
  });
}

// Search for a single user entry after a successful bind.
// Fetches profile fields + memberOf for RBAC group mapping.
function searchUser(client, baseDN, filter) {
  return new Promise((resolve, reject) => {
    const opts = {
      scope: 'sub',
      filter,
      attributes: ['cn', 'displayName', 'mail', 'department', 'memberOf', 'sAMAccountName'],
    };
    client.search(baseDN, opts, (err, res) => {
      if (err) return reject(err);

      let entry = null;
      res.on('searchEntry', (e) => { entry = e.object; });
      res.on('error',       (e) => reject(e));
      res.on('end', () => {
        client.unbind(() => {});
        if (!entry) return reject(Object.assign(new Error('USER_NOT_FOUND'), { code: 'USER_NOT_FOUND' }));
        resolve(entry);
      });
    });
  });
}

// Normalize memberOf: ldapjs returns a string when only one group exists
function normalizeMemberOf(raw) {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

// Classifies raw ldapjs error messages into typed error codes
function classifyLdapError(err) {
  const msg = err.message || '';
  if (
    err.code === 49 ||
    msg.includes('Invalid Credentials') ||
    msg.includes('invalidCredentials')
  ) {
    return 'INVALID_CREDENTIALS';
  }
  if (
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('connect')
  ) {
    return 'LDAP_UNREACHABLE';
  }
  return 'LDAP_ERROR';
}

/**
 * Authenticates a user against the remote LDAP / Active Directory server.
 *
 * Strategy (mirrors meeting-book-server):
 *  1. Build multiple UPN / NETBIOS bind candidates from the raw username.
 *  2. Try each candidate bind in sequence — first success wins.
 *  3. After a successful bind, search for the user's full profile + memberOf.
 *
 * @returns {Promise<{username, name, email, department, memberOf[]}>}
 * @throws  Error with .code = INVALID_CREDENTIALS | LDAP_UNREACHABLE | LDAP_ERROR
 */
async function authenticateUser(username, password) {
  const cfg = getLdapConfig();

  // Build bind candidates — preserving exact meeting-book ordering
  const candidates = [];
  if (username.includes('@') || username.includes('\\')) {
    candidates.push(username);
  } else {
    candidates.push(
      `${username}@${cfg.defaultUPN}`,
      `${username}@${cfg.altUPN}`,
      `${cfg.netbios}\\${username}`,
    );
  }
  if (!candidates.includes(username)) candidates.push(username);

  let lastError = null;

  for (const bindDN of candidates) {
    try {
      const client = createLdapClient(cfg.url);
      await bindClient(client, bindDN, password);

      // sAMAccountName is the short username regardless of bind format used
      const samAccount = username.split('@')[0].split('\\').pop();
      const filter = `(|(userPrincipalName=${bindDN})(sAMAccountName=${samAccount}))`;

      const entry = await searchUser(client, cfg.baseDN, filter);

      return {
        username:   entry.sAMAccountName || samAccount,
        name:       entry.displayName   || entry.cn || username,
        email:      entry.mail          || bindDN,
        department: entry.department    || '',
        memberOf:   normalizeMemberOf(entry.memberOf),
      };
    } catch (err) {
      lastError = err;
      console.warn(`[LDAP] bind/search failed for "${bindDN}": ${err.message}`);
    }
  }

  // All candidates failed — classify and rethrow
  const code = classifyLdapError(lastError);
  throw Object.assign(new Error(lastError ? lastError.message : 'Authentication failed'), { code });
}

module.exports = { authenticateUser };
