const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/jwt');
const sendResponse = require('../utils/response');

/**
 * JWT 认证中间件
 * 从 Authorization header 或 cookie 中提取 token 并验证
 */
function authenticateToken(req, res, next) {
    let token = null;

    // 优先从 Authorization header 获取
    if (req.headers.authorization) {
        const authHeader = req.headers.authorization;
        token = authHeader && authHeader.split(' ')[1];
    }

    if (!token) {
        return sendResponse(res, false, null, '未提供认证令牌', 401);
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error('JWT验证失败:', err.message);
            return sendResponse(res, false, null, '令牌无效或已过期', 403);
        }
        req.user = user;
        next();
    });
}

module.exports = authenticateToken;
