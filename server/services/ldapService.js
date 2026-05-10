// server/services/ldapService.js
const { getLdapConfig, createLdapClient } = require('../config/ldap');

// Attempt to bind with a given DN + password.
// Returns the connected (and bound) client on success.
// Also listens for the 'error' event that ldapjs emits on TCP failures
// (ECONNREFUSED, ETIMEDOUT) which never reach the bind callback.
function bindClient(client, dn, password) {
  return new Promise((resolve, reject) => {
    function fail(err) {
      client.unbind(() => {});
      reject(err);
    }
    client.once('error', fail);
    client.bind(dn, password, (err) => {
      client.removeListener('error', fail);
      if (err) return fail(err);
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

/**
 * Browses all user accounts in Active Directory using a service account.
 * Requires LDAP_BIND_DN and LDAP_BIND_PASSWORD in environment.
 * Filters out computer accounts and disabled users.
 */
async function browseAllUsers() {
  const bindDN  = process.env.LDAP_BIND_DN;
  const bindPwd = process.env.LDAP_BIND_PASSWORD;

  if (!bindDN || !bindPwd) {
    throw Object.assign(
      new Error('LDAP service account not configured (set LDAP_BIND_DN and LDAP_BIND_PASSWORD).'),
      { code: 'NOT_CONFIGURED' }
    );
  }

  const cfg    = getLdapConfig();
  const client = createLdapClient(cfg.url);

  await bindClient(client, bindDN, bindPwd);

  return new Promise((resolve, reject) => {
    const users = [];
    const opts  = {
      scope:      'sub',
      // Active user accounts only (not computers, not disabled)
      filter:     '(&(objectClass=user)(!(objectClass=computer))(sAMAccountName=*))',
      attributes: ['sAMAccountName', 'displayName', 'cn', 'mail', 'department', 'title', 'userAccountControl'],
      sizeLimit:  2000,
    };

    function fail(e) { client.unbind(() => {}); reject(e); }
    client.once('error', fail);

    client.search(cfg.baseDN, opts, (err, res) => {
      if (err) { client.removeListener('error', fail); return fail(err); }

      res.on('searchEntry', (entry) => {
        const o   = entry.object;
        const uac = parseInt(o.userAccountControl || '0', 10);
        if ((uac & 2) !== 0) return; // skip disabled accounts
        users.push({
          username:   o.sAMAccountName || '',
          name:       o.displayName   || o.cn || '',
          email:      o.mail          || '',
          department: o.department    || '',
          title:      o.title         || '',
        });
      });

      res.on('error', (e) => { client.removeListener('error', fail); fail(e); });

      res.on('end', () => {
        client.removeListener('error', fail);
        client.unbind(() => {});
        resolve(users.sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      });
    });
  });
}

module.exports = { authenticateUser, browseAllUsers };
