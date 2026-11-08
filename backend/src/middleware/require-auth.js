function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  next();
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const user = req.session.user;
    if (!user) return res.status(401).json({ error: 'Authentication required.' });
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
