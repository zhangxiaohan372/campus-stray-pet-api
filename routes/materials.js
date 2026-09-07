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

// ====================== 查询物资列表 ======================
router.get('/materials', authenticateToken, authorize(PERMISSIONS.MATERIAL_READ), async (req, res) => {
    try {
        const { page = 1, pageSize = 10, pointCode, species, keyword } = req.query;
        const pageNum = parseInt(page);
        const size = parseInt(pageSize);
        const offset = (pageNum - 1) * size;

        let query = 'SELECT * FROM material_inventory WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) as total FROM material_inventory WHERE 1=1';
        let params = [];

        if (pointCode?.trim()) {
            query += ' AND point_code = ?';
            countQuery += ' AND point_code = ?';
            params.push(pointCode);
        }

        if (species?.trim()) {
            query += ' AND species = ?';
            countQuery += ' AND species = ?';
            params.push(species);
        }

        if (keyword) {
            query += ' AND material_name LIKE ?';
            countQuery += ' AND material_name LIKE ?';
            params.push(`%${keyword}%`);
        }

        query += ' ORDER BY id ASC LIMIT ' + size + ' OFFSET ' + offset;

        const [rows] = await pool.execute(query, params);
        const [countRows] = await pool.execute(countQuery, params);

        const data = rows.map(item => underscoreToCamel(item));
        const total = countRows[0].total;

        sendResponse(res, true, { list: data, total, page: pageNum, pageSize: size });
    } catch (err) {
        console.error('查询物资失败：', err);
        sendResponse(res, false, null, '查询物资库存信息失败：' + err.message, 500);
    }
});

// ====================== 新增物资 ======================
router.post('/materials', authenticateToken, authorize(PERMISSIONS.MATERIAL_WRITE), validate([
    body('pointCode').trim().notEmpty().withMessage('救助点不能为空'),
    body('species').trim().notEmpty().withMessage('物种不能为空'),
    body('materialName').trim().notEmpty().withMessage('物资名称不能为空'),
    body('unit').trim().notEmpty().withMessage('单位不能为空'),
    body('quantity').notEmpty().withMessage('库存不能为空'),
    body('minStock').notEmpty().withMessage('最低库存不能为空')
]), async (req, res) => {
    try {
        const data = camelToUnderscore(req.body);
        const [checkRows] = await pool.execute('SELECT * FROM material_inventory WHERE point_code = ? AND material_name = ?', [data.point_code, data.material_name]);
        if (checkRows.length > 0) return sendResponse(res, false, null, `该救助点已存在【${data.material_name}】，请勿重复添加！`, 400);

        const status = data.quantity >= data.min_stock ? '充足' : '紧缺';
        const [result] = await pool.execute(
            `INSERT INTO material_inventory (point_code, species, material_name, unit, quantity, min_stock, status, operator, remark) VALUES (?,?,?,?,?,?,?,?,?)`,
            [data.point_code, data.species, data.material_name, data.unit, data.quantity, data.min_stock, status, data.operator || '', data.remark || '']
        );
        sendResponse(res, true, { id: result.insertId }, '新增物资库存成功！');
    } catch (err) {
        console.error('新增物资失败：', err);
        sendResponse(res, false, null, '新增物资库存信息失败：' + err.message, 500);
    }
});

// ====================== 编辑物资 ======================
router.put('/materials/:id', authenticateToken, authorize(PERMISSIONS.MATERIAL_WRITE), validate([
    body('species').trim().notEmpty().withMessage('物种不能为空'),
    body('materialName').trim().notEmpty().withMessage('物资名称不能为空'),
    body('unit').trim().notEmpty().withMessage('单位不能为空'),
    body('quantity').notEmpty().withMessage('库存不能为空'),
    body('minStock').notEmpty().withMessage('最低库存不能为空')
]), async (req, res) => {
    try {
        const { id } = req.params;
        if (isNaN(id)) return sendResponse(res, false, null, 'ID必须是数字！', 400);

        const data = camelToUnderscore(req.body);
        const status = data.quantity >= data.min_stock ? '充足' : '紧缺';

        await pool.execute(
            `UPDATE material_inventory SET species=?, material_name=?, unit=?, quantity=?, min_stock=?, status=?, operator=?, remark=? WHERE id=?`,
            [data.species, data.material_name, data.unit, data.quantity, data.min_stock, status, data.operator || '', data.remark || '', id]
        );
        sendResponse(res, true, null, '编辑物资库存成功！');
    } catch (err) {
        console.error('修改物资失败：', err);
        sendResponse(res, false, null, '编辑物资库存信息失败：' + err.message, 500);
    }
});

// ====================== 补充物资 ======================
router.put('/materials/supplement/:id', authenticateToken, authorize(PERMISSIONS.MATERIAL_WRITE), validate([
    body('addCount').isInt({ min: 1 }).withMessage('补充数量必须是大于0的数字')
]), async (req, res) => {
    try {
        const { id } = req.params;
        if (isNaN(id)) return sendResponse(res, false, null, 'ID必须是数字！', 400);

        const data = camelToUnderscore(req.body);
        const [rows] = await pool.execute('SELECT quantity, min_stock FROM material_inventory WHERE id=?', [id]);

        if (rows.length === 0) return sendResponse(res, false, null, '该物资不存在！', 404);

        const { quantity: currentQty, min_stock: minQty } = rows[0];
        const newQty = currentQty + data.add_count;
        const newStatus = newQty >= minQty ? '充足' : '紧缺';

        await pool.execute(
            `UPDATE material_inventory SET quantity=?, status=?, operator=?, remark=? WHERE id=?`,
            [newQty, newStatus, data.operator || '', data.remark || `补充${data.add_count}${data.unit || ''}，更新后库存${newQty}`, id]
        );
        sendResponse(res, true, null, `补充物资成功！当前库存：${newQty}${data.unit || ''}`);
    } catch (err) {
        console.error('补充物资失败：', err);
        sendResponse(res, false, null, '补充物资库存失败：' + err.message, 500);
    }
});

// ====================== 删除物资 ======================
router.delete('/materials/:id', authenticateToken, authorize(PERMISSIONS.MATERIAL_WRITE), async (req, res) => {
    try {
        const { id } = req.params;
        if (isNaN(id)) return sendResponse(res, false, null, 'ID必须是数字！', 400);

        await pool.execute('DELETE FROM material_inventory WHERE id=?', [id]);
        sendResponse(res, true, null, '删除物资库存成功！');
    } catch (err) {
        console.error('删除物资失败：', err);
        sendResponse(res, false, null, '删除物资库存信息失败：' + err.message, 500);
    }
});

// ====================== 物资图表数据 ======================
router.get('/materials/chart-data', authenticateToken, authorize(PERMISSIONS.MATERIAL_READ), async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM material_inventory');
        const materials = rows.map(item => underscoreToCamel(item));

        const shortageByPoint = {};
        materials.forEach(item => {
            if (item.quantity <= item.minStock) {
                shortageByPoint[item.pointCode] = (shortageByPoint[item.pointCode] || 0) + 1;
            }
        });

        const pieData = Object.keys(shortageByPoint).map(key => ({
            name: key,
            value: shortageByPoint[key]
        }));

        const categories = materials.map(item => `${item.pointCode}-${item.materialName}`);
        const quantityData = materials.map(item => item.quantity);
        const minStockData = materials.map(item => item.minStock);

        sendResponse(res, true, { pieData, barData: { categories, quantityData, minStockData } });
    } catch (err) {
        console.error('获取物资图表数据失败：', err);
        sendResponse(res, false, null, '获取物资图表数据失败：' + err.message, 500);
    }
});

module.exports = router;
