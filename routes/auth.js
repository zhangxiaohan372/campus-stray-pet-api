const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { body } = require('express-validator');
const pool = require('../config/db');
const { signToken } = require('../config/jwt');
const authenticateToken = require('../middleware/auth');
const validate = require('../middleware/validate');
const sendResponse = require('../utils/response');
const { getNowTime } = require('../utils/time');
const { getPermissionsByRole, getPermissionTree } = require('../services/permissionService');

// ====================== 管理员登录 ======================
router.post('/login', validate([
    body('name').trim().notEmpty().withMessage('管理员名称不能为空'),
    body('password').trim().notEmpty().withMessage('密码不能为空')
]), async (req, res) => {
    try {
        const { name, password } = req.body;
        const [users] = await pool.execute('SELECT * FROM users WHERE username = ?', [name]);

        if (users.length === 0) return sendResponse(res, false, null, '管理员名称不存在', 400);

        const user = users[0];
        const isPwdCorrect = await bcrypt.compare(password, user.password);
        if (!isPwdCorrect) return sendResponse(res, false, null, '密码错误', 400);

        const token = signToken({ id: user.id, name: user.name, role: user.role });
        const permissions = await getPermissionsByRole(user.role);

        sendResponse(res, true, { id: user.id, name: user.name, role: user.role, token, permissions }, '登录成功');
    } catch (err) {
        console.error('登录报错：', err);
        sendResponse(res, false, null, '登录失败', 500);
    }
});

// ====================== 管理员退出 ======================
router.post('/logout', authenticateToken, (req, res) => {
    sendResponse(res, true, null, '登出成功');
});

// ====================== 学生登录 ======================
router.post('/student/login', validate([
    body('studentId').trim().notEmpty().withMessage('学号不能为空'),
    body('password').trim().notEmpty().withMessage('密码不能为空')
]), async (req, res) => {
    try {
        const { studentId, password } = req.body;

        const [students] = await pool.execute('SELECT * FROM user WHERE studentId = ?', [studentId]);

        if (students.length === 0) {
            return sendResponse(res, false, null, '学号不存在', 400);
        }

        const student = students[0];
        if (!student.password) {
            const defaultPassword = studentId;
            const hashedPassword = await bcrypt.hash(defaultPassword, 10);
            await pool.execute('UPDATE user SET password = ? WHERE id = ?', [hashedPassword, student.id]);
            const [updatedStudents] = await pool.execute('SELECT * FROM user WHERE studentId = ?', [studentId]);
            if (updatedStudents.length > 0) {
                student.password = updatedStudents[0].password;
            }
        }

        const isPwdCorrect = await bcrypt.compare(password, student.password);
        if (!isPwdCorrect) {
            return sendResponse(res, false, null, '密码错误', 400);
        }

        await pool.execute(
            'UPDATE user SET activeScore = activeScore + 1, loginCount = loginCount + 1, lastLoginTime = ?, lastActiveTime = ? WHERE studentId = ?',
            [getNowTime(), getNowTime(), studentId]
        );

        const token = signToken({
            id: student.id,
            studentId: student.studentId,
            name: student.name,
            major: student.major,
            role: student.role
        });

        const permissions = await getPermissionsByRole(student.role);

        return sendResponse(res, true, {
            id: student.id,
            studentId: student.studentId,
            name: student.name,
            major: student.major,
            role: student.role,
            avatarUrl: student.avatar_url || '',
            token: token,
            permissions
        }, '学生登录成功');
    } catch (err) {
        console.error('登录报错:', err);
        return sendResponse(res, false, null, '登录失败', 500);
    }
});

// ====================== 修改密码 ======================
router.post('/student/change-password', authenticateToken, validate([
    body('oldPassword').trim().notEmpty().withMessage('旧密码不能为空'),
    body('newPassword').trim().notEmpty().withMessage('新密码不能为空')
]), async (req, res) => {
    try {
        const userId = req.user.id;
        const { oldPassword, newPassword } = req.body;

        const [users] = await pool.execute('SELECT * FROM user WHERE id = ?', [userId]);

        if (users.length === 0) {
            return sendResponse(res, false, null, '用户不存在', 400);
        }

        const user = users[0];
        const isOldPwdCorrect = await bcrypt.compare(oldPassword, user.password);
        if (!isOldPwdCorrect) {
            return sendResponse(res, false, null, '旧密码不正确', 400);
        }

        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        await pool.execute('UPDATE user SET password = ? WHERE id = ?', [newPasswordHash, userId]);

        return sendResponse(res, true, null, '密码修改成功');
    } catch (err) {
        console.error('学生修改密码报错:', err.stack);
        return sendResponse(res, false, null, '修改密码失败：' + err.message, 500);
    }
});

router.get('/me/permissions', authenticateToken, async (req, res) => {
    try {
        const role = req.user?.role;
        const permissions = await getPermissionsByRole(role);
        const tree = await getPermissionTree();
        sendResponse(res, true, {
            role,
            permissions,
            tree
        }, '查询权限成功');
    } catch (err) {
        console.error('查询权限失败:', err);
        sendResponse(res, false, null, '查询权限失败', 500);
    }
});

module.exports = router;
