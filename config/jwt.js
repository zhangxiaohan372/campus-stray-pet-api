const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'management-system-2026-secret-key-abc123';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function signToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

module.exports = { JWT_SECRET, JWT_EXPIRES_IN, signToken };
