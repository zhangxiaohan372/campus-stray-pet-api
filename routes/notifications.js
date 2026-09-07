const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');
const sendResponse = require('../utils/response');

// ====================== 通知列表 ======================
router.get('/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const [rows] = await pool.execute(
            `SELECT id, type, related_id, content, create_time
             FROM notifications
             WHERE user_id = ?
             ORDER BY create_time DESC`,
            [userId]
        );
        const list = rows.map(row => ({
            id: row.id,
            type: row.type,
            relatedId: row.related_id,
            content: row.content,
            createTime: row.create_time
        }));
        sendResponse(res, true, list);
    } catch (err) {
        console.error('获取通知失败:', err);
        sendResponse(res, false, null, '获取通知失败', 500);
    }
});

module.exports = router;
