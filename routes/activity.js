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
const createNotification = require('../services/notificationService');

// ====================== 活动列表 ======================
router.get('/activity', authenticateToken, authorize(PERMISSIONS.ACTIVITY_READ), async (req, res) => {
    try {
        const { page = 1, pageSize = 10, keyword, status } = req.query;
        const pageNum = parseInt(page);
        const size = parseInt(pageSize);
        const offset = (pageNum - 1) * size;

        let query = 'SELECT * FROM activity WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) as total FROM activity WHERE 1=1';
        let params = [];

        if (keyword) {
            query += ' AND title LIKE ?';
            countQuery += ' AND title LIKE ?';
            params.push(`%${keyword}%`);
        }

        if (status && status !== 'all') {
            query += ' AND status = ?';
            countQuery += ' AND status = ?';
            params.push(status);
        }

        query += ' ORDER BY id DESC LIMIT ' + size + ' OFFSET ' + offset;

        const [rows] = await pool.execute(query, params);
        const [countRows] = await pool.execute(countQuery, params);

        const data = rows.map(item => underscoreToCamel(item));
        const total = countRows[0].total;

        sendResponse(res, true, { list: data, total, page: pageNum, pageSize: size });
    } catch (err) {
        console.error('查询活动失败：', err);
        sendResponse(res, false, null, '查询活动信息失败：' + err.message, 500);
    }
});

// ====================== 活跃度排行榜 ======================
router.get('/activity/ranking', authenticateToken, authorize(PERMISSIONS.ACTIVITY_READ), async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT studentId, name, COALESCE(activeScore, 0) as activeScore FROM user ORDER BY activeScore DESC LIMIT 10'
        );
        const data = rows.map(item => underscoreToCamel(item));
        sendResponse(res, true, data);
    } catch (err) {
        console.error('获取活跃度排行榜失败：', err);
        sendResponse(res, false, null, '获取活跃度排行榜失败', 500);
    }
});

// ====================== 活动详情 ======================
router.get('/activity/:id', authenticateToken, authorize(PERMISSIONS.ACTIVITY_READ), async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.execute('SELECT * FROM activity WHERE id = ?', [id]);
        if (rows.length === 0) return sendResponse(res, false, null, '活动不存在', 404);
        const data = underscoreToCamel(rows[0]);
        sendResponse(res, true, data);
    } catch (err) {
        console.error('查询活动详情失败：', err);
        sendResponse(res, false, null, '查询活动详情失败：' + err.message, 500);
    }
});

// ====================== 报名活动 ======================
router.post('/activity/join', authenticateToken, authorize(PERMISSIONS.ACTIVITY_JOIN), async (req, res) => {
    try {
        const { activityId } = req.body;
        const studentId = req.user.id;

        const [exists] = await pool.execute(
            'SELECT * FROM activity_join WHERE student_id = ? AND activity_id = ?',
            [studentId, activityId]
        );
        if (exists.length > 0) {
            return sendResponse(res, false, null, '你已经报名过该活动', 400);
        }

        const [activityRows] = await pool.execute('SELECT title FROM activity WHERE id = ?', [activityId]);
        const activityTitle = activityRows.length ? activityRows[0].title : '活动';

        await pool.execute(
            'INSERT INTO activity_join (student_id, activity_id) VALUES (?, ?)',
            [studentId, activityId]
        );

        await pool.execute(
            'UPDATE activity SET joined_count = joined_count + 1 WHERE id = ?',
            [activityId]
        );

        await createNotification(studentId, 'activity_join', activityId, `您已成功报名活动“${activityTitle}”，请准时参加。`);

        sendResponse(res, true, null, '报名成功！');
    } catch (err) {
        console.error('活动报名失败：', err);
        sendResponse(res, false, null, '报名失败：' + err.message, 500);
    }
});

// ====================== 取消报名 ======================
router.post('/activity/cancel', authenticateToken, authorize(PERMISSIONS.ACTIVITY_JOIN), async (req, res) => {
    try {
        const { activityId } = req.body;
        const studentId = req.user.id;

        const [result] = await pool.execute(
            'DELETE FROM activity_join WHERE student_id = ? AND activity_id = ?',
            [studentId, activityId]
        );
        if (result.affectedRows === 0) {
            return sendResponse(res, false, null, '未找到报名记录', 400);
        }

        await pool.execute(
            'UPDATE activity SET joined_count = joined_count - 1 WHERE id = ?',
            [activityId]
        );

        sendResponse(res, true, null, '取消报名成功');
    } catch (err) {
        console.error('取消报名失败：', err);
        sendResponse(res, false, null, '取消报名失败：' + err.message, 500);
    }
});

// ====================== 我的活动 ======================
router.get('/my/activity', authenticateToken, authorize(PERMISSIONS.ACTIVITY_JOIN), async (req, res) => {
    try {
        const studentId = req.user.id;
        const [rows] = await pool.execute(`
            SELECT a.* FROM activity a
            JOIN activity_join j ON a.id = j.activity_id
            WHERE j.student_id = ?
            ORDER BY a.id DESC
        `, [studentId]);

        const data = rows.map(item => underscoreToCamel(item));
        sendResponse(res, true, data);
    } catch (err) {
        console.error('获取我的活动失败：', err);
        sendResponse(res, false, null, '获取我的活动失败：' + err.message, 500);
    }
});

// ====================== 新增活动 ======================
router.post('/activity', authenticateToken, authorize(PERMISSIONS.ACTIVITY_WRITE), validate([
    body('title').trim().notEmpty().withMessage('活动名称不能为空'),
    body('content').trim().notEmpty().withMessage('活动内容不能为空'),
    body('activityTime').notEmpty().withMessage('活动时间不能为空'),
    body('volunteerHours').optional().isInt({ min: 0 }).withMessage('志愿时长必须是整数')
]), async (req, res) => {
    try {
        const data = camelToUnderscore(req.body);
        const volunteerHours = data.volunteer_hours || 0;
        const [result] = await pool.execute(
            'INSERT INTO activity (title, content, activity_time, volunteer_hours, status) VALUES (?,?,?,?,?)',
            [data.title, data.content, data.activity_time, volunteerHours, 'pending']
        );
        sendResponse(res, true, { id: result.insertId }, '新增活动成功！');
    } catch (err) {
        console.error('新增活动失败：', err);
        sendResponse(res, false, null, '新增活动失败：' + err.message, 500);
    }
});

// ====================== 修改活动 ======================
router.put('/activity/:id', authenticateToken, authorize(PERMISSIONS.ACTIVITY_WRITE), validate([
    body('title').trim().notEmpty().withMessage('活动名称不能为空'),
    body('content').trim().notEmpty().withMessage('活动内容不能为空'),
    body('activityTime').notEmpty().withMessage('活动时间不能为空'),
    body('volunteerHours').isInt({ min: 0 }).withMessage('志愿时长必须是整数'),
    body('status').notEmpty().withMessage('活动状态不能为空')
]), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, activityTime, volunteerHours, status } = req.body;

        await pool.query('START TRANSACTION');

        try {
            await pool.execute(
                'UPDATE activity SET title=?, content=?, activity_time=?, volunteer_hours=?, status=? WHERE id=?',
                [title, content, activityTime, volunteerHours, status, id]
            );

            if (status === 'completed') {
                const [students] = await pool.execute(
                    'SELECT student_id FROM activity_join WHERE activity_id = ?',
                    [id]
                );
                for (const student of students) {
                    const userId = student.student_id;
                    await pool.execute(
                        'UPDATE user SET volunteerTime = volunteerTime + ?, activeScore = activeScore + ? * 5, lastActiveTime = ? WHERE id = ?',
                        [volunteerHours, volunteerHours, getNowTime(), userId]
                    );
                    await createNotification(
                        userId, 'activity_end', id,
                        `活动“${title}”已结束，您获得了 ${volunteerHours} 小时志愿时长和 ${volunteerHours * 5} 点活跃度`
                    );
                }
            }

            await pool.query('COMMIT');
            sendResponse(res, true, null, '修改活动成功！');
        } catch (error) {
            await pool.query('ROLLBACK');
            throw error;
        }
    } catch (err) {
        console.error('修改活动失败:', err);
        sendResponse(res, false, null, '修改活动失败：' + err.message, 500);
    }
});

// ====================== 删除活动 ======================
router.delete('/activity/:id', authenticateToken, authorize(PERMISSIONS.ACTIVITY_WRITE), async (req, res) => {
    try {
        const { id } = req.params;
        await pool.execute('DELETE FROM activity_join WHERE activity_id = ?', [id]);
        await pool.execute('DELETE FROM activity WHERE id = ?', [id]);
        sendResponse(res, true, null, '删除活动成功！');
    } catch (err) {
        console.error('删除活动失败：', err);
        sendResponse(res, false, null, '删除活动失败：' + err.message, 500);
    }
});

// ====================== 活动参与者 ======================
router.get('/activity/:id/participants', authenticateToken, authorize(PERMISSIONS.ACTIVITY_WRITE), async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.execute(`
            SELECT u.id, u.studentId, u.name, u.phone
            FROM user u
            JOIN activity_join j ON u.id = j.student_id
            WHERE j.activity_id = ?
            ORDER BY u.id ASC
        `, [id]);
        const data = rows.map(item => underscoreToCamel(item));
        sendResponse(res, true, data);
    } catch (err) {
        console.error('获取活动参与者失败：', err);
        sendResponse(res, false, null, '获取活动参与者失败：' + err.message, 500);
    }
});

module.exports = router;
