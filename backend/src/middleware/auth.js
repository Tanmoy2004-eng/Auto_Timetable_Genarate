const jwt = require('jsonwebtoken');
const config = require('../config');
const { HttpError } = require('./errors');

function signToken(user) {
  return jwt.sign({ id: user.id }, config.jwtSecret, { expiresIn: '7d' });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Authentication required'));
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.userId = payload.id;
    next();
  } catch {
    next(new HttpError(401, 'Session expired, please log in again'));
  }
}

module.exports = { signToken, requireAuth };
