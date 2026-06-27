// Ensures every DB query is scoped to the user's organization
function tenantIsolation(req, res, next) {
  if (!req.user || !req.user.orgId) {
    return res.status(403).json({ error: 'Tenant context missing' });
  }
  // Attach orgId to request for use in routes
  req.orgId = req.user.orgId;
  req.orgName = req.user.orgName;
  next();
}

// Helper to inject org_id into query args
function withOrg(orgId, args = []) {
  return [orgId, ...args];
}

module.exports = { tenantIsolation, withOrg };
