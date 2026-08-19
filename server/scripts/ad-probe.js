// server/scripts/ad-probe.js
//
// Read-only diagnostic. Prints exactly which attributes Active Directory
// returns for a handful of accounts, so a question like "where does the email
// address actually live?" is answered by looking rather than by guessing.
//
//   node scripts/ad-probe.js              -> 3 sample accounts
//   node scripts/ad-probe.js a.alkubaesy  -> one specific account
//
// Writes nothing, changes nothing.
require('dotenv').config();
const { getLdapConfig, createLdapClient } = require('../config/ldap');

const WANT = process.argv[2] || null;

// Attributes worth seeing when hunting for a mail address. '*' would also work
// but floods the output with thumbnailPhoto and friends.
const ATTRS = [
  'sAMAccountName', 'displayName', 'cn',
  'mail', 'userPrincipalName', 'proxyAddresses', 'targetAddress', 'mailNickname',
  'department', 'userAccountControl',
];

function bind(client, dn, pwd) {
  return new Promise((resolve, reject) => {
    const fail = e => { client.unbind(() => {}); reject(e); };
    client.once('error', fail);
    client.bind(dn, pwd, err => { client.removeListener('error', fail); err ? fail(err) : resolve(); });
  });
}

(async () => {
  const cfg = getLdapConfig();
  const bindDN = process.env.LDAP_BIND_DN;
  const bindPwd = process.env.LDAP_BIND_PASSWORD;
  if (!bindDN || !bindPwd) {
    console.error('[probe] LDAP_BIND_DN / LDAP_BIND_PASSWORD not set in server/.env');
    process.exit(1);
  }

  const client = createLdapClient(cfg.url);
  await bind(client, bindDN, bindPwd);
  console.log(`[probe] bound as ${bindDN}`);
  console.log(`[probe] baseDN ${cfg.baseDN}\n`);

  const filter = WANT
    ? `(&(objectClass=user)(sAMAccountName=${WANT}))`
    : '(&(objectClass=user)(!(objectClass=computer))(sAMAccountName=*))';

  const found = [];
  let scanned = 0;
  const stats = Object.fromEntries(
    ['mail', 'userPrincipalName', 'proxyAddresses', 'targetAddress', 'mailNickname'].map(k => [k, 0])
  );

  await new Promise((resolve, reject) => {
    client.search(cfg.baseDN, { scope: 'sub', filter, attributes: ATTRS, sizeLimit: 2000 }, (err, res) => {
      if (err) return reject(err);
      res.on('searchEntry', e => {
        const o = e.object || {};
        if ((parseInt(o.userAccountControl || '0', 10) & 2) !== 0) return; // disabled
        scanned++;
        for (const k of Object.keys(stats)) if (o[k] && String(o[k]).length) stats[k]++;
        if (found.length < (WANT ? 1 : 3)) found.push(o);
      });
      res.on('error', reject);
      res.on('end', resolve);
    });
  });

  console.log(`[probe] ${scanned} enabled accounts scanned\n`);
  console.log('ATTRIBUTE POPULATION across all of them:');
  for (const [k, v] of Object.entries(stats)) {
    console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)} / ${scanned}`);
  }

  console.log('\nSAMPLE ACCOUNTS — every attribute AD actually sent back:');
  for (const o of found) {
    console.log('\n  ── ' + (o.sAMAccountName || '?') + ' ──');
    for (const [k, v] of Object.entries(o)) {
      if (k === 'controls' || k === 'userAccountControl') continue;
      console.log('    ' + k.padEnd(20) + JSON.stringify(v));
    }
  }

  client.unbind(() => {});
  console.log('\n[probe] done — nothing was modified');
})().catch(e => {
  console.error('[probe] failed:', e.message);
  process.exit(1);
});
