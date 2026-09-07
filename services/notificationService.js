const pool = require('../config/db');
const { getNowTime } = require('../utils/time');

/**
 * 创建系统通知
 * @param {number} userId - 接收通知的用户 ID
 * @param {string} type - 通知类型
 * @param {number} relatedId - 关联 ID
 * @param {string} content - 通知内容
 */
async function createNotification(userId, type, relatedId, content) {
    try {
        const now = getNowTime();
        await pool.execute(
            'INSERT INTO notifications (user_id, type, related_id, content, create_time) VALUES (?, ?, ?, ?, ?)',
            [userId, type, relatedId || null, content, now]
        );
    } catch (err) {
        console.error('创建通知失败:', err);
    }
}

module.exports = createNotification;
