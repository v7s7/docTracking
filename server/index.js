// server/index.js
const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const authRoutes  = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const deptRoutes  = require('./routes/departments');

const app  = express();
const PORT = process.env.PORT || 5000;

if (!process.env.JWT_SECRET) {
  console.error('[Server] FATAL: JWT_SECRET is not set. Refusing to start.');
  process.exit(1);
}
if (!process.env.LDAP_URL) {
  console.error('[Server] FATAL: LDAP_URL is not set. Refusing to start.');
  process.exit(1);
}

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(bodyParser.json());

app.use('/auth',        authRoutes);
app.use('/admin',       adminRoutes);   // all routes inside are SUPER_ADMIN-only
app.use('/departments', deptRoutes);    // any authenticated user

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] docTracking API running on http://0.0.0.0:${PORT}`);
});
