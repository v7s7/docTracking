// server/config/ldap.js
const ldap = require('ldapjs');
require('dotenv').config();

function getLdapConfig() {
  const url = process.env.LDAP_URL;
  if (!url) throw new Error('LDAP_URL is not defined in environment variables.');

  return {
    url,
    baseDN:     process.env.LDAP_BASE_DN     || 'DC=example,DC=local',
    defaultUPN: process.env.LDAP_DEFAULT_UPN || 'example.com',
    altUPN:     process.env.LDAP_ALT_UPN     || 'example.local',
    netbios:    process.env.LDAP_NETBIOS     || 'EXAMPLE',
  };
}

// Factory: creates a fresh ldapjs client per request (no shared state).
// Automatically uses TLS when the URL scheme is ldaps://
function createLdapClient(url) {
  const isSecure = url.startsWith('ldaps://');
  return ldap.createClient({
    url,
    timeout:        8000,
    connectTimeout: 8000,
    reconnect:      false,
    ...(isSecure
      ? { tlsOptions: { rejectUnauthorized: process.env.NODE_ENV === 'production' } }
      : {}),
  });
}

module.exports = { getLdapConfig, createLdapClient };
