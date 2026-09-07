const { validationResult } = require('express-validator');
const sendResponse = require('../utils/response');

/**
 * 请求参数校验中间件工厂
 * @param {Array} validations - express-validator 的验证链数组
 * @returns {Function} Express 中间件
 */
function validate(validations) {
    return async (req, res, next) => {
        await Promise.all(validations.map(v => v.run(req)));
        const errors = validationResult(req);
        if (errors.isEmpty()) return next();
        return sendResponse(res, false, null, errors.array()[0].msg, 400);
    };
}

module.exports = validate;
