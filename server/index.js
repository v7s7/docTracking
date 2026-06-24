const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const bodyParser = require('body-parser');
const path       = require('path');
const fs         = require('fs');
require('dotenv').config();

// Initialise DB before routes so the schema is ready
require('./db');

const authRoutes      = require('./routes/auth');
const adminRoutes     = require('./routes/admin');
const deptRoutes      = require('./routes/departments');
const usersRoutes     = require('./routes/users');
const tasksRoutes         = require('./routes/tasks');
const dashboardRoutes     = require('./routes/dashboard');
const notificationsRoutes = require('./routes/notifications');
const sessionsRoutes  = require('./routes/sessions');
const templatesRoutes = require('./routes/templates');
const auditRoutes     = require('./routes/audit');
const messagesRoutes  = require('./routes/messages');
const personalTasksRoutes = require('./routes/personalTasks');
const scheduler        = require('./services/scheduler');

const app  = express();
const PORT = process.env.PORT || 5000;

if (!process.env.JWT_SECRET) {
  console.error('[Server] FATAL: JWT_SECRET is not set. Refusing to start.');
  process.exit(1);
}

app.disable('x-powered-by');

// Security headers (CSP, X-Frame-Options, X-Content-Type-Options, HSTS, etc.).
// helmet merges these with its own defaults, so upgradeInsecureRequests must be
// nulled out explicitly — otherwise browsers rewrite every asset request to
// https:// and the app breaks outright until TLS is actually configured.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'"],
      styleSrc:      ["'self'", "'unsafe-inline'"],
      fontSrc:       ["'self'"],
      imgSrc:        ["'self'", 'data:'],
      connectSrc:    ["'self'"],
      objectSrc:     ["'none'"],
      baseUri:       ["'self'"],
      frameAncestors: ["'self'"],
      formAction:    ["'self'"],
      scriptSrcAttr: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
}));

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'data', 'uploads')));

app.use('/auth',        authRoutes);
app.use('/admin',       adminRoutes);      // SUPER_ADMIN only
app.use('/departments', deptRoutes);       // any authenticated user
app.use('/users',       usersRoutes);      // SUPER_ADMIN only
app.use('/tasks',       tasksRoutes);      // role-filtered inside
app.use('/dashboard',      dashboardRoutes);     // role-filtered inside
app.use('/notifications',  notificationsRoutes); // per-dept unread count
app.use('/messages',   messagesRoutes);    // chat: DMs + department conversations
app.use('/personal-tasks', personalTasksRoutes); // a user's own to-do list
app.use('/sessions',  sessionsRoutes);
app.use('/templates', templatesRoutes);
app.use('/audit',     auditRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Serve the production React build, if present, so the API and the web
// app can run from a single process/port (npm run build in client/ first).
const clientBuildPath = path.join(__dirname, '..', 'client', 'build');
const clientIndexPath = path.join(clientBuildPath, 'index.html');
if (fs.existsSync(clientIndexPath)) {
  app.use(express.static(clientBuildPath));
  // Only fall back to the SPA shell for client-side routes (no file extension).
  // Paths that look like static files (e.g. /sitemap.xml, /favicon.ico) but don't
  // exist should 404 instead of silently returning the app shell.
  app.get('*', (req, res, next) => {
    if (path.extname(req.path)) return next();
    res.sendFile(clientIndexPath);
  });
  console.log('[Server] Serving client build from', clientBuildPath);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] docTracking API running on http://0.0.0.0:${PORT}`);
  scheduler.start();
});
