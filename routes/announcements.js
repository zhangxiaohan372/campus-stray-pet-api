const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const sendResponse = require('../utils/response');
const { PERMISSIONS } = require('../config/permissions');
const { camelToUnderscore, underscoreToCamel } = require('../utils/caseConvert');
const { getNowTime } = require('../utils/time');

// ====================== 查询公告列表 ======================
router.get('/announcements', authenticateToken, authorize(PERMISSIONS.ANNOUNCEMENT_READ), async (req, res) => {
    try {
        let page = parseInt(req.query.page);
        let pageSize = parseInt(req.query.pageSize);
        if (isNaN(page) || page < 1) page = 1;
        if (isNaN(pageSize) || pageSize < 1) pageSize = 10;
        const offset = (page - 1) * pageSize;

        const [countRows] = await pool.execute('SELECT COUNT(*) as total FROM announcements');
        const total = countRows[0].total;

        const sql = `SELECT * FROM announcements ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}`;
        const [rows] = await pool.execute(sql);

        const data = rows.map(item => {
            const camelItem = underscoreToCamel(item);
            return { ...camelItem, author: '管理员' };
        });

        sendResponse(res, true, { list: data, total, page, pageSize });
    } catch (err) {
        console.error('查询公告失败：', err);
        sendResponse(res, false, null, '查询失败：' + err.message, 500);
    }
});

// ====================== 新增公告 ======================
router.post('/announcements', authenticateToken, authorize(PERMISSIONS.ANNOUNCEMENT_WRITE), validate([
    body('title').trim().notEmpty().withMessage('标题不能为空'),
    body('description').trim().notEmpty().withMessage('内容不能为空')
]), async (req, res) => {
    try {
        const data = camelToUnderscore(req.body);
        const [result] = await pool.execute(
            'INSERT INTO announcements (title, description, time) VALUES (?,?,?)',
            [data.title, data.description, getNowTime()]
        );
        sendResponse(res, true, { id: result.insertId }, '新增公告成功！');
    } catch (err) {
        console.error('新增公告失败：', err);
        sendResponse(res, false, null, '新增失败：' + err.message, 500);
    }
});

// ====================== 修改公告 ======================
router.put('/announcements/:id', authenticateToken, authorize(PERMISSIONS.ANNOUNCEMENT_WRITE), validate([
    body('title').trim().notEmpty().withMessage('标题不能为空'),
    body('description').trim().notEmpty().withMessage('内容不能为空')
]), async (req, res) => {
    try {
        const { id } = req.params;
        if (isNaN(id)) return sendResponse(res, false, null, 'ID必须是数字！', 400);
        const data = camelToUnderscore(req.body);

        await pool.execute(
            'UPDATE announcements SET title=?, description=?, time=? WHERE id=?',
            [data.title, data.description, getNowTime(), id]
        );
        sendResponse(res, true, null, '修改公告成功！');
    } catch (err) {
        console.error('修改公告失败：', err);
        sendResponse(res, false, null, '修改失败：' + err.message, 500);
    }
});

// ====================== 删除公告 ======================
router.delete('/announcements/:id', authenticateToken, authorize(PERMISSIONS.ANNOUNCEMENT_WRITE), async (req, res) => {
    try {
        const { id } = req.params;
        if (isNaN(id)) return sendResponse(res, false, null, 'ID必须是数字！', 400);

        await pool.execute('DELETE FROM announcements WHERE id=?', [id]);
        sendResponse(res, true, null, '删除公告成功！');
    } catch (err) {
        console.error('删除公告失败：', err);
        sendResponse(res, false, null, '删除失败：' + err.message, 500);
    }
});

module.exports = router;
