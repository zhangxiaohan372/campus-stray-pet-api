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

// ====================== 查询小狗列表 ======================
router.get('/dogs', authenticateToken, authorize(PERMISSIONS.PET_READ), async (req, res) => {
    try {
        const { page = 1, pageSize = 10, keyword, healthStatus } = req.query;
        const pageNum = parseInt(page);
        const size = parseInt(pageSize);
        const offset = (pageNum - 1) * size;

        let query = 'SELECT * FROM dogs WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) as total FROM dogs WHERE 1=1';
        let params = [];

        if (keyword) {
            query += ' AND name LIKE ?';
            countQuery += ' AND name LIKE ?';
            params.push(`%${keyword}%`);
        }

        if (healthStatus && healthStatus !== 'all') {
            query += ' AND health_status = ?';
            countQuery += ' AND health_status = ?';
            params.push(healthStatus);
        }

        query += ' ORDER BY id ASC';
        if (!isNaN(size) && size > 0) {
            query += ' LIMIT ' + size + ' OFFSET ' + offset;
        }

        const [rows] = await pool.execute(query, params);
        const [countRows] = await pool.execute(countQuery, params);

        const data = rows.map(item => underscoreToCamel(item));
        const total = countRows[0].total;

        sendResponse(res, true, { list: data, total, page: pageNum, pageSize: size });
    } catch (err) {
        console.error('查询小狗失败：', err);
        sendResponse(res, false, null, '查询小狗信息失败：' + err.message, 500);
    }
});

// ====================== 新增小狗 ======================
router.post('/dogs', authenticateToken, authorize(PERMISSIONS.PET_WRITE), validate([
    body('name').trim().notEmpty().withMessage('名称不能为空'),
    body('age').notEmpty().withMessage('年龄不能为空'),
    body('breed').trim().notEmpty().withMessage('品种不能为空'),
    body('healthStatus').trim().notEmpty().withMessage('健康状态不能为空'),
    body('health').trim().notEmpty().withMessage('健康描述不能为空'),
    body('area').trim().notEmpty().withMessage('区域不能为空')
]), async (req, res) => {
    try {
        const data = camelToUnderscore(req.body);
        data.found_time = data.found_time || getNowTime();
        data.is_dead = data.is_dead || 0;
        data.dead_time = data.dead_time || null;

        const [result] = await pool.execute(
            'INSERT INTO dogs (name, age, breed, health_status, health, area, found_time, is_dead, dead_time, image_url) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [data.name, data.age, data.breed, data.health_status, data.health, data.area, data.found_time, data.is_dead, data.dead_time, data.image_url || null]
        );
        sendResponse(res, true, { id: result.insertId }, '新增小狗信息成功！');
    } catch (err) {
        console.error('新增小狗失败：', err);
        sendResponse(res, false, null, '新增小狗信息失败：' + err.message, 500);
    }
});

// ====================== 修改小狗 ======================
router.put('/dogs/:id', authenticateToken, authorize(PERMISSIONS.PET_WRITE), validate([
    body('name').trim().notEmpty().withMessage('名称不能为空'),
    body('age').notEmpty().withMessage('年龄不能为空'),
    body('breed').trim().notEmpty().withMessage('品种不能为空'),
    body('healthStatus').trim().notEmpty().withMessage('健康状态不能为空'),
    body('health').trim().notEmpty().withMessage('健康描述不能为空'),
    body('area').trim().notEmpty().withMessage('区域不能为空')
]), async (req, res) => {
    try {
        const { id } = req.params;
        if (isNaN(id)) return sendResponse(res, false, null, 'ID必须是数字！', 400);

        const data = camelToUnderscore(req.body);
        if (!data.found_time) {
            const [rows] = await pool.execute('SELECT found_time FROM dogs WHERE id=?', [id]);
            data.found_time = rows?.[0]?.found_time || getNowTime();
        }
        data.is_dead = data.is_dead || 0;
        data.dead_time = data.dead_time || null;

        await pool.execute(
            'UPDATE dogs SET name=?, age=?, breed=?, health_status=?, health=?, area=?, found_time=?, is_dead=?, dead_time=?, image_url=? WHERE id=?',
            [data.name, data.age, data.breed, data.health_status, data.health, data.area, data.found_time, data.is_dead, data.dead_time, data.image_url || null, id]
        );
        sendResponse(res, true, null, '修改小狗信息成功！');
    } catch (err) {
        console.error('修改小狗失败：', err);
        sendResponse(res, false, null, '修改小狗信息失败：' + err.message, 500);
    }
});

// ====================== 删除小狗 ======================
router.delete('/dogs/:id', authenticateToken, authorize(PERMISSIONS.PET_WRITE), async (req, res) => {
    try {
        const { id } = req.params;
        if (isNaN(id)) return sendResponse(res, false, null, 'ID必须是数字！', 400);

        await pool.execute('DELETE FROM dogs WHERE id=?', [id]);
        sendResponse(res, true, null, '删除小狗信息成功！');
    } catch (err) {
        console.error('删除小狗失败：', err);
        sendResponse(res, false, null, '删除小狗信息失败：' + err.message, 500);
    }
});

module.exports = router;
