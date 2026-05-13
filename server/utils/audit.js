const { db } = require('../db');

function logAudit(actor, action, targetType, targetId, details, ip) {
  try {
    db.prepare(
      'INSERT INTO audit_log (actor_username, actor_role, action, target_type, target_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      actor?.username || 'system',
      actor?.role     || '',
      action,
      targetType || '',
      targetId != null ? String(targetId) : '',
      details    ? JSON.stringify(details) : null,
      ip         || ''
    );
  } catch (e) {
    console.warn('[Audit] Log failed:', e.message);
  }
}

module.exports = { logAudit };
