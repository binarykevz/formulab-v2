function tenantIsolation(req, res, next) {
  if (!req.user || !req.user.orgId) return res.status(403).json({ error: 'Tenant context missing' });
  req.orgId = req.user.orgId;
  req.orgName = req.user.orgName;
  next();
}
module.exports = { tenantIsolation };