const { logAudit } = require('../db/audit');

function audit(action, resource) {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function(body) {
      logAudit({
        orgId: req.user?.orgId, userId: req.user?.id, username: req.user?.username,
        action, resource, resourceId: req.params.id || body?.id,
        details: { method: req.method, path: req.path },
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
        status: res.statusCode < 400 ? 'SUCCESS' : 'FAILED'
      }).catch(e => console.error('Audit error:', e));
      return originalJson(body);
    };
    next();
  };
}
module.exports = { audit };