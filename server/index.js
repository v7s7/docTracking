const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

// Initialise DB before routes so the schema is ready
require('./db');

const authRoutes      = require('./routes/auth');
const adminRoutes     = require('./routes/admin');
const deptRoutes      = require('./routes/departments');
const usersRoutes     = require('./routes/users');
const tasksRoutes     = require('./routes/tasks');
const dashboardRoutes = require('./routes/dashboard');

const app  = express();
const PORT = process.env.PORT || 5000;

if (!process.env.JWT_SECRET) {
  console.error('[Server] FATAL: JWT_SECRET is not set. Refusing to start.');
  process.exit(1);
}

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(bodyParser.json());

app.use('/auth',        authRoutes);
app.use('/admin',       adminRoutes);      // SUPER_ADMIN only
app.use('/departments', deptRoutes);       // any authenticated user
app.use('/users',       usersRoutes);      // SUPER_ADMIN only
app.use('/tasks',       tasksRoutes);      // role-filtered inside
app.use('/dashboard',   dashboardRoutes);  // role-filtered inside

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] docTracking API running on http://0.0.0.0:${PORT}`);
});
