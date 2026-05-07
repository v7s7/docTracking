// server/services/configService.js
// Single source of truth for departments, fields, and role group mappings.
// Reads from / writes to server/config/departments.json.
// Uses an in-memory cache so repeated reads within a request are free;
// the cache is refreshed on every write so panel changes apply immediately.
const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../config/departments.json');

const DEFAULT_CONFIG = { departments: [], roleGroupMap: {} };

let cache = null;

function readConfig() {
  if (!cache) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      cache = JSON.parse(raw);
    } catch {
      cache = { ...DEFAULT_CONFIG };
    }
  }
  return cache;
}

function writeConfig(data) {
  // Strip internal note so it isn't duplicated; preserve it if present
  const toWrite = { ...data };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(toWrite, null, 2), 'utf8');
  cache = toWrite; // keep cache consistent with disk
}

module.exports = { readConfig, writeConfig };
