const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { body } = require('express-validator');
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const sendResponse = require('../utils/response');
const { PERMISSIONS } = require('../config/permissions');
const { camelToUnderscore, underscoreToCamel } = require('../utils/caseConvert');
const { getNowTime } = require('../utils/time');

// ====================== 查询用户列表 ======================
router.get('/users', authenticateToken, authorize(PERMISSIONS.USER_READ), async (req, res) => {
    try {
        const { page = 1, pageSize = 10, keyword, role } = req.query;
        const pageNum = parseInt(page);
        const size = parseInt(pageSize);
        const offset = (pageNum - 1) * size;

        let query = `
            SELECT id, studentId, name, phone, email, role,
                registerTime, lastActiveTime, volunteerTime,
                loginCount, lastLoginTime, volunteerActivityCount,
                createTime, updateTime, activeScore, major
            FROM user WHERE 1=1
        `;
        let countQuery = 'SELECT COUNT(*) as total FROM user WHERE 1=1';
        let params = [];

        if (keyword) {
            query += ' AND (name LIKE ? OR studentId LIKE ?)';
            countQuery += ' AND (name LIKE ? OR studentId LIKE ?)';
            params.push(`%${keyword}%`, `%${keyword}%`);
        }

        if (role && role !== 'all') {
            query += ' AND role = ?';
            countQuery += ' AND role = ?';
            params.push(role);
        }

        query += ' ORDER BY id ASC LIMIT ' + size + ' OFFSET ' + offset;

        const [rows] = await pool.execute(query, params);
        const [countRows] = await pool.execute(countQuery, params);

        const data = rows.map(item => underscoreToCamel(item));
        const total = countRows[0].total;

        sendResponse(res, true, { list: data, total, page: pageNum, pageSize: size });
    } catch (err) {
        console.error('查询用户失败：', err);
        sendResponse(res, false, null, '查询用户信息失败：' + err.message, 500);
    }
});

// ====================== 新增用户 ======================
router.post('/users', authenticateToken, authorize(PERMISSIONS.USER_WRITE), validate([
    body('studentId').trim().notEmpty().withMessage('学号不能为空'),
    body('name').trim().notEmpty().withMessage('姓名不能为空'),
    body('phone').trim().notEmpty().withMessage('手机号不能为空'),
    body('email').trim().notEmpty().withMessage('邮箱不能为空'),
    body('role').trim().notEmpty().withMessage('角色不能为空'),
    body('registerTime').trim().notEmpty().withMessage('注册时间不能为空'),
    body('major').trim().notEmpty().withMessage('专业不能为空')
]), async (req, res) => {
    try {
        const data = camelToUnderscore(req.body);
        const [checkRows] = await pool.execute('SELECT * FROM user WHERE studentId = ?', [data.student_id]);
        if (checkRows.length > 0) return sendResponse(res, false, null, '该学号已存在！', 400);

        const now = getNowTime();
        const hashedPassword = await bcrypt.hash('123456', 10);
        const [result] = await pool.execute(
            `INSERT INTO user (studentId, name, phone, email, role, registerTime, lastActiveTime, volunteerTime, loginCount, lastLoginTime, volunteerActivityCount, activeScore, major, password, createTime, updateTime) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [data.student_id, data.name, data.phone, data.email, data.role, data.register_time, now, data.volunteer_time || 0, data.login_count || 0, now, data.volunteer_activity_count || 0, data.active_score || 0, data.major, hashedPassword, now, now]
        );
        sendResponse(res, true, { id: result.insertId }, '新增用户信息成功！');
    } catch (err) {
        console.error('新增用户失败：', err);
        sendResponse(res, false, null, '新增用户信息失败：' + err.message, 500);
    }
});

// ====================== 修改用户 ======================
router.put('/users/:studentId', authenticateToken, authorize(PERMISSIONS.USER_WRITE), validate([
    body('name').trim().notEmpty().withMessage('姓名不能为空'),
    body('phone').trim().notEmpty().withMessage('手机号不能为空'),
    body('email').trim().notEmpty().withMessage('邮箱不能为空'),
    body('role').trim().notEmpty().withMessage('角色不能为空'),
    body('registerTime').trim().notEmpty().withMessage('注册时间不能为空'),
    body('lastActiveTime').trim().notEmpty().withMessage('最后活跃时间不能为空')
]), async (req, res) => {
    try {
        const { studentId } = req.params;
        const data = camelToUnderscore(req.body);
        const now = getNowTime();

        await pool.execute(
            `UPDATE user SET name=?, phone=?, email=?, role=?, registerTime=?, lastActiveTime=?,
   volunteerTime=?, loginCount=?, lastLoginTime=?, volunteerActivityCount=?,
   activeScore=?, updateTime=? WHERE studentId=?`,
            [
                data.name, data.phone, data.email, data.role, data.register_time, data.last_active_time,
                data.volunteer_time || 0, data.login_count || 0, data.last_login_time || now,
                data.volunteer_activity_count || 0,
                data.active_score || 0,
                now, studentId
            ]
        );
        sendResponse(res, true, null, '修改用户信息成功！');
    } catch (err) {
        console.error('修改用户失败：', err);
        sendResponse(res, false, null, '修改用户信息失败：' + err.message, 500);
    }
});

// ====================== 删除用户 ======================
router.delete('/users/:studentId', authenticateToken, authorize(PERMISSIONS.USER_WRITE), async (req, res) => {
    try {
        const { studentId } = req.params;
        if (!studentId?.trim()) return sendResponse(res, false, null, '学号不能为空！', 400);

        await pool.execute('DELETE FROM user WHERE studentId = ?', [studentId]);
        sendResponse(res, true, null, '删除用户信息成功！');
    } catch (err) {
        console.error('删除用户失败：', err);
        sendResponse(res, false, null, '删除用户信息失败：' + err.message, 500);
    }
});

module.exports = router;
