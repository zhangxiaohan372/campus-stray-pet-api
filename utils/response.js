/**
 * 统一响应格式
 * @param {object} res - Express response 对象
 * @param {boolean} success - 是否成功
 * @param {*} data - 返回数据
 * @param {string} msg - 提示消息
 * @param {number} statusCode - HTTP 状态码
 */
function sendResponse(res, success, data = null, msg = '', statusCode = 200) {
    res.status(statusCode).json({ success, data, msg });
}

module.exports = sendResponse;
