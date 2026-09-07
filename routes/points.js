const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const sendResponse = require('../utils/response');
const { PERMISSIONS } = require('../config/permissions');
const { underscoreToCamel } = require('../utils/caseConvert');

// ====================== 查询救助点列表 ======================
router.get('/points', authenticateToken, authorize(PERMISSIONS.POINT_READ), async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM feeding_points ORDER BY id ASC');
        const data = rows.map(item => {
            const camelItem = underscoreToCamel(item);
            return { ...camelItem, position: [camelItem.lng, camelItem.lat] };
        });
        sendResponse(res, true, data);
    } catch (err) {
        console.error('查询救助点失败：', err);
        sendResponse(res, false, null, '查询救助点信息失败：' + err.message, 500);
    }
});

// ====================== 新增救助点 ======================
router.post('/points', authenticateToken, authorize(PERMISSIONS.POINT_WRITE), async (req, res) => {
    try {
        const { name, address, desc, food, contact, lng, lat } = req.body;
        if (!name || !name.trim()) return sendResponse(res, false, null, '点位名称不能为空', 400);
        if (!address || !address.trim()) return sendResponse(res, false, null, '详细地址不能为空', 400);
        if (isNaN(lng) || isNaN(lat)) return sendResponse(res, false, null, '经纬度必须是数字', 400);

        const [result] = await pool.execute(
            'INSERT INTO feeding_points (name, address, `desc`, food, contact, lng, lat) VALUES (?,?,?,?,?,?,?)',
            [name, address, desc || '', food || '', contact || '', lng, lat]
        );
        sendResponse(res, true, { id: result.insertId }, '新增救助点成功！');
    } catch (err) {
        console.error('新增救助点失败：', err);
        sendResponse(res, false, null, '新增救助点信息失败：' + err.message, 500);
    }
});

// ====================== 修改救助点 ======================
router.put('/points/:id', authenticateToken, authorize(PERMISSIONS.POINT_WRITE), validate([
    body('name').trim().notEmpty().withMessage('点位名称不能为空'),
    body('address').trim().notEmpty().withMessage('详细地址不能为空'),
    body('lng').isNumeric().withMessage('经度必须是数字'),
    body('lat').isNumeric().withMessage('纬度必须是数字')
]), async (req, res) => {
    try {
        const { id } = req.params;
        if (isNaN(id)) return sendResponse(res, false, null, 'ID必须是数字！', 400);
        const { name, address, desc, food, contact, lng, lat } = req.body;

        await pool.execute(
            'UPDATE feeding_points SET name=?, address=?, `desc`=?, food=?, contact=?, lng=?, lat=? WHERE id=?',
            [name, address, desc || '', food || '', contact || '', lng, lat, id]
        );
        sendResponse(res, true, null, '修改救助点信息成功！');
    } catch (err) {
        console.error('修改救助点失败：', err);
        sendResponse(res, false, null, '修改救助点信息失败：' + err.message, 500);
    }
});

// ====================== 删除救助点 ======================
router.delete('/points/:id', authenticateToken, authorize(PERMISSIONS.POINT_WRITE), async (req, res) => {
    try {
        const { id } = req.params;
        if (isNaN(id)) return sendResponse(res, false, null, 'ID必须是数字！', 400);

        await pool.execute('DELETE FROM feeding_points WHERE id=?', [id]);
        sendResponse(res, true, null, '删除救助点成功！');
    } catch (err) {
        console.error('删除救助点失败：', err);
        sendResponse(res, false, null, '删除救助点信息失败：' + err.message, 500);
    }
});

// ====================== 范围查询救助点 ======================
router.get('/points/scope', authenticateToken, authorize(PERMISSIONS.POINT_READ), async (req, res) => {
    try {
        const { minLng, maxLng, minLat, maxLat } = req.query;
        if (!minLng || !maxLng || !minLat || !maxLat) return sendResponse(res, false, null, '请传入完整的经纬度范围！', 400);

        const [rows] = await pool.execute('SELECT * FROM feeding_points WHERE lng BETWEEN ? AND ? AND lat BETWEEN ? AND ?', [minLng, maxLng, minLat, maxLat]);
        const data = rows.map(item => {
            const camelItem = underscoreToCamel(item);
            return { ...camelItem, position: [camelItem.lng, camelItem.lat] };
        });
        sendResponse(res, true, data);
    } catch (err) {
        console.error('范围查询救助点失败：', err);
        sendResponse(res, false, null, '范围查询救助点失败：' + err.message, 500);
    }
});

module.exports = router;
