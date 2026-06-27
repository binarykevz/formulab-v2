const { logAudit } = require('../db/audit');

function audit(action, resource) {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      // Log after response is determined
      const status = res.statusCode < 400 ? 'SUCCESS' : 'FAILED';
      logAudit({
        orgId: req.user?.orgId,
        userId: req.user?.id,
        username: req.user?.username,
        action,
        resource,
        resourceId: req.params.id || body?.id || null,
        details: {
          method: req.method,
          path: req.path,
          body: req.method !== 'GET' ? req.body : undefined,
          responseBody: status === 'FAILED' ? body : undefined
        },
        ipAddress: req.ip || req.headers['x-forwarded-for'],
        userAgent: req.headers['user-agent'],
        status
      }).catch(err => console.error('Audit log error:', err));

      return originalJson(body);
    };
    next();
  };
}

module.exports = { audit };
