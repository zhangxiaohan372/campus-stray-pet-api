// ====================== 1. 依赖导入 ======================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
// 点赞防抖并发锁（内存锁）
const processingLikes = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// 确保 uploads 目录存在
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ====================== 阿里云 OSS 配置 ======================
let ossClient = null;
let useOSS = false;

if (process.env.OSS_ACCESS_KEY_ID && process.env.OSS_ACCESS_KEY_SECRET) {
    try {
        const OSS = require('ali-oss');
        ossClient = new OSS({
            region: process.env.OSS_REGION,
            accessKeyId: process.env.OSS_ACCESS_KEY_ID,
            accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
            bucket: process.env.OSS_BUCKET
        });
        useOSS = true;
        console.log('✅ OSS 已配置');
    } catch (error) {
        console.error('OSS 初始化失败，将使用本地存储:', error.message);
    }
}

// ====================== 上传配置 ======================
const upload = multer({
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

const app = express();
const port = process.env.PORT || 3001;
const BASE_URL = process.env.SERVER_BASE_URL || `http://localhost:${port}`;
// ====================== 阿里云内容安全（AI 图片审核） ======================
const GreenSDK = require("@alicloud/green20220302");
const GreenClient = GreenSDK.default;
const { ImageModerationRequest } = GreenSDK;
const { Config } = require("@alicloud/openapi-client");

let greenClient = null;
let useAudit = false;

try {
    const config = new Config({
        accessKeyId: process.env.OSS_ACCESS_KEY_ID, // 复用 OSS
        accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
        endpoint: "green.cn-shanghai.aliyuncs.com",
    });
    greenClient = new GreenClient(config);
    useAudit = true;
    console.log("✅ AI 图片审核已配置");
} catch (err) {
    console.error("AI 审核初始化失败:", err.message);
}
// ====================== 2. 全局中间件配置 ======================
const corsOptions = {
    origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',')
        : ['http://localhost:5173'],
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ====================== 3. 数据库连接池 ======================
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'management',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    dateStrings: true
});

// ====================== 4. JWT 配置 ======================
const JWT_SECRET = process.env.JWT_SECRET || 'management-system-2026-secret-key-abc123';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ====================== 5. 核心工具函数 ======================
const sendResponse = (res, success, data = null, msg = '', statusCode = 200) => {
    res.status(statusCode).json({ success, data, msg });
};

// 获取当前东八区时间
function getNowTime() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// 驼峰 ↔ 下划线转换
const camelToUnderscore = (obj) => {
    if (typeof obj !== 'object' || obj === null) return obj;
    const newObj = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const newKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
            newObj[newKey] = obj[key];
        }
    }
    return newObj;
};
// AI审核工具函数
// ====================== AI 图片审核工具函数 ======================
async function auditAvatarImage(imageUrl) {
    if (!useAudit) return { pass: true, riskLevel: 'none', label: '', description: '' };

    try {
        const request = new ImageModerationRequest({
            service: "baselineCheck",
            serviceParameters: JSON.stringify({
                imageUrl: imageUrl,
                dataId: "avatar_" + Date.now(),
            }),
        });

        const res = await greenClient.imageModeration(request);
        const data = res?.body?.data;
        const riskLevel = data?.riskLevel || "none";

        const firstResult = data?.result?.[0] || {};
        const label = firstResult.label || "";
        const description = firstResult.description || "";

        const pass = (riskLevel === "none");

        console.log("[AI审核结果]", { riskLevel, label, description, pass });

        return { pass, riskLevel, label, description };
    } catch (err) {
        console.error("AI 审核出错：", err);
        return { pass: false, riskLevel: 'error', label: 'system_error', description: '审核服务异常' };
    }
}
const underscoreToCamel = (obj) => {
    if (typeof obj !== 'object' || obj === null) return obj;
    const newObj = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const newKey = key.replace(/(_\w)/g, (match) => match[1].toUpperCase());
            newObj[newKey] = obj[key];
        }
    }
    return newObj;
};

// JWT 认证中间件
const authenticateToken = (req, res, next) => {
    let token = null;
    if (req.headers.authorization) {
        const authHeader = req.headers.authorization;
        token = authHeader && authHeader.split(' ')[1];
    }
    if (!token) {
        return sendResponse(res, false, null, '未提供认证令牌', 401);
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error('JWT验证失败:', err.message);
            return sendResponse(res, false, null, '令牌无效或已过期', 403);
        }
        req.user = user;
        next();
    });
};

// 请求参数校验中间件
const validate = (validations) => {
    return async (req, res, next) => {
        await Promise.all(validations.map(v => v.run(req)));
        const errors = validationResult(req);
        if (errors.isEmpty()) return next();
        return sendResponse(res, false, null, errors.array()[0].msg, 400);
    };
};

// ====================== 6. 创建通知函数 ======================
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

// ====================== 7. 管理员登录接口 ======================
app.post('/api/login', validate([
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

        const token = jwt.sign(
            { id: user.id, name: user.name, role: user.role },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        sendResponse(res, true, { id: user.id, name: user.name, role: user.role, token }, '登录成功');
    } catch (err) {
        console.error('登录报错：', err);
        sendResponse(res, false, null, '登录失败', 500);
    }
});

app.post('/api/logout', authenticateToken, (req, res) => {
    sendResponse(res, true, null, '登出成功');
});

// ====================== 8. 小猫接口 ======================
app.get('/api/cats', authenticateToken, async (req, res) => {
    try {
        const { page = 1, pageSize = 10, keyword, healthStatus } = req.query;
        const pageNum = parseInt(page);
        const size = parseInt(pageSize);
        const offset = (pageNum - 1) * size;

        let query = 'SELECT * FROM cats WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) as total FROM cats WHERE 1=1';
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

        sendResponse(res, true, {
            list: data,
            total,
            page: pageNum,
            pageSize: size
        });
    } catch (err) {
        console.error('查询小猫失败：', err);
        sendResponse(res, false, null, '查询小猫信息失败：' + err.message, 500);
    }
});

app.post('/api/cats', authenticateToken, validate([
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
            'INSERT INTO cats (name, age, breed, health_status, health, area, found_time, is_dead, dead_time, image_url) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [data.name, data.age, data.breed, data.health_status, data.health, data.area, data.found_time, data.is_dead, data.dead_time, data.image_url || null]
        );
        sendResponse(res, true, { id: result.insertId }, '新增小猫信息成功！');
    } catch (err) {
        console.error('新增小猫失败：', err);
        sendResponse(res, false, null, '新增小猫信息失败：' + err.message, 500);
    }
});

app.put('/api/cats/:id', authenticateToken, validate([
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
            const [rows] = await pool.execute('SELECT found_time FROM cats WHERE id=?', [id]);
            data.found_time = rows?.[0]?.found_time || getNowTime();
        }
        data.is_dead = data.is_dead || 0;
        data.dead_time = data.dead_time || null;

        await pool.execute(
            'UPDATE cats SET name=?, age=?, breed=?, health_status=?, health=?, area=?, found_time=?, is_dead=?, dead_time=?, image_url=? WHERE id=?',
            [data.name, data.age, data.breed, data.health_status, data.health, data.area, data.found_time, data.is_dead, data.dead_time, data.image_url || null, id]
        );
        sendResponse(res, true, null, '修改小猫信息成功！');
    } catch (err) {
        console.error('修改小猫失败：', err);
        sendResponse(res, false, null, '修改小猫信息失败：' + err.message, 500);
    }
});

app.delete('/api/cats/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (isNaN(id)) return sendResponse(res, false, null, 'ID必须是数字！', 400);

        await pool.execute('DELETE FROM cats WHERE id=?', [id]);
        sendResponse(res, true, null, '删除小猫信息成功！');
    } catch (err) {
        console.error('删除小猫失败：', err);
        sendResponse(res, false, null, '删除小猫信息失败：' + err.message, 500);
    }
});

// ====================== 9. 小狗接口 ======================
app.get('/api/dogs', authenticateToken, async (req, res) => {
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

        sendResponse(res, true, {
            list: data,
            total,
            page: pageNum,
            pageSize: size
        });
    } catch (err) {
        console.error('查询小狗失败：', err);
        sendResponse(res, false, null, '查询小狗信息失败：' + err.message, 500);
    }
});

app.post('/api/dogs', authenticateToken, validate([
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

app.put('/api/dogs/:id', authenticateToken, validate([
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

app.delete('/api/dogs/:id', authenticateToken, async (req, res) => {
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

// ====================== 10. 用户接口 ======================
app.get('/api/users', authenticateToken, async (req, res) => {
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

        sendResponse(res, true, {
            list: data,
            total,
            page: pageNum,
            pageSize: size
        });
    } catch (err) {
        console.error('查询用户失败：', err);
        sendResponse(res, false, null, '查询用户信息失败：' + err.message, 500);
    }
});

app.post('/api/users', authenticateToken, validate([
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

app.put('/api/users/:studentId', authenticateToken, validate([
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

app.delete('/api/users/:studentId', authenticateToken, async (req, res) => {
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

// ====================== 11. 物资库存接口 ======================
app.get('/api/materials', authenticateToken, async (req, res) => {
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

        sendResponse(res, true, {
            list: data,
            total,
            page: pageNum,
            pageSize: size
        });
    } catch (err) {
        console.error('查询物资失败：', err);
        sendResponse(res, false, null, '查询物资库存信息失败：' + err.message, 500);
    }
});

app.post('/api/materials', authenticateToken, validate([
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

app.put('/api/materials/:id', authenticateToken, validate([
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

app.put('/api/materials/supplement/:id', authenticateToken, validate([
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

app.delete('/api/materials/:id', authenticateToken, async (req, res) => {
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

// ====================== 12. 救助点接口 ======================
app.get('/api/points', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM feeding_points ORDER BY id ASC');
        const data = rows.map(item => {
            const camelItem = underscoreToCamel(item);
            return {
                ...camelItem,
                position: [camelItem.lng, camelItem.lat]
            };
        });
        sendResponse(res, true, data);
    } catch (err) {
        console.error('查询救助点失败：', err);
        sendResponse(res, false, null, '查询救助点信息失败：' + err.message, 500);
    }
});

app.post('/api/points', async (req, res) => {
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

app.put('/api/points/:id', authenticateToken, validate([
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

app.delete('/api/points/:id', authenticateToken, async (req, res) => {
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

app.get('/api/points/scope', authenticateToken, async (req, res) => {
    try {
        const { minLng, maxLng, minLat, maxLat } = req.query;
        if (!minLng || !maxLng || !minLat || !maxLat) return sendResponse(res, false, null, '请传入完整的经纬度范围！', 400);

        const [rows] = await pool.execute('SELECT * FROM feeding_points WHERE lng BETWEEN ? AND ? AND lat BETWEEN ? AND ?', [minLng, maxLng, minLat, maxLat]);
        const data = rows.map(item => {
            const camelItem = underscoreToCamel(item);
            return {
                ...camelItem,
                position: [camelItem.lng, camelItem.lat]
            };
        });
        sendResponse(res, true, data);
    } catch (err) {
        console.error('范围查询救助点失败：', err);
        sendResponse(res, false, null, '范围查询救助点失败：' + err.message, 500);
    }
});

// ====================== 13. 公告接口 ======================
app.get('/api/announcements', authenticateToken, async (req, res) => {
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

        sendResponse(res, true, {
            list: data,
            total: total,
            page: page,
            pageSize: pageSize
        });
    } catch (err) {
        console.error('查询公告失败：', err);
        sendResponse(res, false, null, '查询失败：' + err.message, 500);
    }
});

app.post('/api/announcements', authenticateToken, validate([
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

app.put('/api/announcements/:id', authenticateToken, validate([
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

app.delete('/api/announcements/:id', authenticateToken, async (req, res) => {
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
// ====================== 论坛热榜接口（含评论数） ======================
app.get('/api/student/forum/hot', authenticateToken, async (req, res) => {
    try {
        let page = parseInt(req.query.page);
        let pageSize = parseInt(req.query.pageSize);
        if (isNaN(page) || page < 1) page = 1;
        if (isNaN(pageSize) || pageSize < 1) pageSize = 10;
        const offset = (page - 1) * pageSize;

        // 获取总数
        const [countRows] = await pool.execute('SELECT COUNT(*) as total FROM student_forum');
        const total = countRows[0].total;

        // SQL 添加评论数子查询
        const sql = `
            SELECT 
                sf.*,
                (SELECT COUNT(*) FROM forum_comments WHERE post_id = sf.id) AS comment_count
            FROM student_forum sf
            ORDER BY sf.view_count DESC, sf.create_time DESC
            LIMIT ${pageSize} OFFSET ${offset}
        `;
        const [rows] = await pool.execute(sql);

        const data = rows.map(item => {
            const camelItem = underscoreToCamel(item);
            // 确保 commentCount 字段存在且为数字
            camelItem.commentCount = item.comment_count || 0;
            return camelItem;
        });

        sendResponse(res, true, {
            list: data,
            total: total,
            page: page,
            pageSize: pageSize
        });
    } catch (err) {
        console.error('获取热榜失败:', err);
        sendResponse(res, false, null, '获取热榜失败', 500);
    }
});
// ====================== 14. 学生论坛帖子接口 ======================
app.get('/api/student/forum', authenticateToken, async (req, res) => {
    try {
        let page = parseInt(req.query.page);
        let pageSize = parseInt(req.query.pageSize);
        if (isNaN(page) || page < 1) page = 1;
        if (isNaN(pageSize) || pageSize < 1) pageSize = 10;
        const offset = (page - 1) * pageSize;

        const [countRows] = await pool.execute('SELECT COUNT(*) as total FROM student_forum');
        const total = countRows[0].total;

        const sql = `SELECT * FROM student_forum ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}`;
        const [rows] = await pool.execute(sql);

        const data = rows.map(item => underscoreToCamel(item));

        sendResponse(res, true, {
            list: data,
            total: total,
            page: page,
            pageSize: pageSize
        });
    } catch (err) {
        console.error('查询帖子失败：', err);
        sendResponse(res, false, null, '查询失败', 500);
    }
});

app.get('/api/student/forum/:postId', authenticateToken, async (req, res) => {
    try {
        const { postId } = req.params;
        await pool.execute('UPDATE student_forum SET view_count = view_count + 1 WHERE id = ?', [postId]);
        const [rows] = await pool.execute('SELECT * FROM student_forum WHERE id = ?', [postId]);
        if (!rows.length) return sendResponse(res, false, null, '帖子不存在');
        sendResponse(res, true, underscoreToCamel(rows[0]));
    } catch (err) {
        sendResponse(res, false, null, '查询失败', 500);
    }
});

app.post('/api/student/forum', authenticateToken, validate([
    body('title').trim().notEmpty().withMessage('标题不能为空'),
    body('description').trim().notEmpty().withMessage('内容不能为空')
]), async (req, res) => {
    try {
        const { title, description } = req.body;
        const author = req.user.name;
        const studentNo = req.user.studentId;

        const [result] = await pool.execute(
            `INSERT INTO student_forum (author, student_no, title, description, create_time, view_count, like_count) 
             VALUES (?, ?, ?, ?, ?, 0, 0)`,
            [author, studentNo, title, description, getNowTime()]
        );

        // 发帖时增加活跃度 +2
        await pool.execute(
            'UPDATE user SET activeScore = activeScore + 2, lastActiveTime = ? WHERE studentId = ?',
            [getNowTime(), studentNo]
        );

        sendResponse(res, true, { id: result.insertId }, '发布成功！');
    } catch (err) {
        console.error(err);
        sendResponse(res, false, null, '发布失败', 500);
    }
});

app.get('/api/student/my/forum', authenticateToken, async (req, res) => {
    try {
        const studentNo = req.user.studentId;
        const [rows] = await pool.execute('SELECT * FROM student_forum WHERE student_no = ? ORDER BY id DESC', [studentNo]);
        sendResponse(res, true, rows.map(item => underscoreToCamel(item)));
    } catch (err) {
        sendResponse(res, false, null, '查询失败', 500);
    }
});

app.delete('/api/student/forum/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const studentNo = req.user.studentId;

        const [post] = await pool.execute('SELECT student_no FROM student_forum WHERE id = ?', [id]);
        if (!post.length || post[0].student_no !== studentNo) {
            return sendResponse(res, false, null, '无权限删除', 403);
        }

        await pool.execute('DELETE FROM forum_comments WHERE post_id = ?', [id]);
        await pool.execute('DELETE FROM like_record WHERE post_id = ?', [id]);
        await pool.execute('DELETE FROM student_forum WHERE id = ?', [id]);

        sendResponse(res, true, null, '删除成功！');
    } catch (err) {
        sendResponse(res, false, null, '删除失败', 500);
    }
});

// ====================== 15. 学生统计数据接口 ======================
app.get('/api/student/stats', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const [userRows] = await pool.execute(
            'SELECT studentId, volunteerTime, activeScore FROM user WHERE id = ?',
            [userId]
        );

        if (userRows.length === 0) {
            return sendResponse(res, false, null, '用户不存在', 404);
        }

        const studentId = userRows[0].studentId;
        const volunteerTime = userRows[0].volunteerTime || 0;
        const activeScore = userRows[0].activeScore || 0;

        const [postRows] = await pool.execute(
            'SELECT COUNT(*) as count FROM student_forum WHERE student_no = ?',
            [studentId]
        );
        const postCount = postRows[0].count;

        sendResponse(res, true, {
            volunteerTime: volunteerTime,
            postCount: postCount,
            activeScore: activeScore
        }, '获取成功');
    } catch (err) {
        console.error('获取用户统计数据失败:', err);
        sendResponse(res, false, null, '获取统计数据失败', 500);
    }
});

// ====================== 16. 论坛评论接口 ======================
app.get('/api/student/forum/:postId/comments', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM forum_comments WHERE post_id = ? ORDER BY id DESC',
            [req.params.postId]
        );
        sendResponse(res, true, rows.map(item => underscoreToCamel(item)));
    } catch (err) {
        sendResponse(res, false, null, '查询失败', 500);
    }
});

app.post('/api/student/forum/:postId/comments', authenticateToken, validate([
    body('content').trim().notEmpty().withMessage('评论不能为空')
]), async (req, res) => {
    try {
        const { postId } = req.params;
        const { content } = req.body;
        const authorName = req.user.name;
        const studentNo = req.user.studentId;

        const [result] = await pool.execute(
            `INSERT INTO forum_comments (post_id, author_name, student_no, content, time) 
             VALUES (?, ?, ?, ?, ?)`,
            [postId, authorName, studentNo, content, getNowTime()]
        );

        // 评论时增加活跃度 +1
        await pool.execute(
            'UPDATE user SET activeScore = activeScore + 1, lastActiveTime = ? WHERE studentId = ?',
            [getNowTime(), studentNo]
        );

        sendResponse(res, true, { id: result.insertId }, '评论成功');
    } catch (err) {
        console.error('评论接口详细错误:', err);
        sendResponse(res, false, null, '评论失败: ' + err.message, 500);
    }
});

app.get('/api/student/my/comments', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM forum_comments WHERE student_no = ? ORDER BY id DESC',
            [req.user.studentId]
        );
        sendResponse(res, true, rows.map(item => underscoreToCamel(item)));
    } catch (err) {
        sendResponse(res, false, null, '查询失败', 500);
    }
});

app.delete('/api/student/forum/comments/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const studentNo = req.user.studentId;

        const [comment] = await pool.execute('SELECT student_no FROM forum_comments WHERE id = ?', [id]);
        if (!comment.length || comment[0].student_no !== studentNo) {
            return sendResponse(res, false, null, '无权限', 403);
        }

        await pool.execute('DELETE FROM forum_comments WHERE id = ?', [id]);
        sendResponse(res, true, null, '删除成功');
    } catch (err) {
        sendResponse(res, false, null, '删除失败', 500);
    }
});

// ====================== 17. 点赞接口（稳定防并发版） ======================
app.post('/api/student/forum/:postId/like', authenticateToken, async (req, res) => {
    const studentNo = req.user.studentId;
    const { postId } = req.params;

    // 同一用户请求串行化，最多重试5次
    for (let retry = 0; retry < 5; retry++) {
        if (processingLikes.has(studentNo)) {
            await delay(100);
            continue;
        }
        processingLikes.set(studentNo, true);

        try {
            const [exist] = await pool.execute(
                'SELECT id FROM like_record WHERE student_no = ? AND post_id = ? LIMIT 1',
                [studentNo, postId]
            );

            if (exist.length > 0) {
                // 取消点赞
                await pool.execute('DELETE FROM like_record WHERE id = ?', [exist[0].id]);
                await pool.execute('UPDATE student_forum SET like_count = like_count - 1 WHERE id = ?', [postId]);
                return sendResponse(res, true, { isLiked: false }, '已取消点赞');
            } else {
                // 新增点赞
                await pool.execute('INSERT INTO like_record (student_no, post_id) VALUES (?, ?)', [studentNo, postId]);
                await pool.execute('UPDATE student_forum SET like_count = like_count + 1 WHERE id = ?', [postId]);

                // 发送通知（可选）
                try {
                    const [post] = await pool.execute('SELECT author FROM student_forum WHERE id = ?', [postId]);
                    if (post.length) {
                        const postAuthor = post[0].author;
                        const [authorUser] = await pool.execute('SELECT id FROM user WHERE name = ? LIMIT 1', [postAuthor]);
                        if (authorUser.length) {
                            const authorUserId = authorUser[0].id;
                            await createNotification(authorUserId, 'like', postId, `${req.user.name} 点赞了你的帖子`);
                        }
                    }
                } catch (noticeErr) {
                    console.error('发送点赞通知失败（不影响主流程）:', noticeErr);
                }

                return sendResponse(res, true, { isLiked: true }, '点赞成功');
            }
        } catch (err) {
            // 特殊处理重复键错误（防并发插入）
            if (err.code === 'ER_DUP_ENTRY') {
                try {
                    await pool.execute('DELETE FROM like_record WHERE student_no = ? AND post_id = ?', [studentNo, postId]);
                    await pool.execute('UPDATE student_forum SET like_count = like_count - 1 WHERE id = ?', [postId]);
                    return sendResponse(res, true, { isLiked: false }, '已取消点赞');
                } catch (e) {
                    console.error('重复键错误处理失败:', e);
                }
            }
            console.error('点赞接口报错:', err);
            return sendResponse(res, false, null, '操作失败，请稍后再试', 500);
        } finally {
            processingLikes.delete(studentNo);
        }
    }
    return sendResponse(res, false, null, '系统繁忙，请稍后再试', 500);
});

app.get('/api/student/forum/:postId/like/status', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT id FROM like_record WHERE student_no = ? AND post_id = ?',
            [req.user.studentId, req.params.postId]
        );
        sendResponse(res, true, { isLiked: rows.length > 0 });
    } catch (err) {
        sendResponse(res, false, null, '查询失败', 500);
    }
});
// ====================== 论坛热榜接口（历史浏览量榜） ======================

// ====================== 18. 志愿活动接口 ======================
app.get('/api/activity', authenticateToken, async (req, res) => {
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

        sendResponse(res, true, {
            list: data,
            total,
            page: pageNum,
            pageSize: size
        });
    } catch (err) {
        console.error('查询活动失败：', err);
        sendResponse(res, false, null, '查询活动信息失败：' + err.message, 500);
    }
});

// ====================== 26. 活跃度排行榜接口 ======================
app.get('/api/activity/ranking', authenticateToken, async (req, res) => {
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

app.get('/api/activity/:id', authenticateToken, async (req, res) => {
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

app.post('/api/activity/join', authenticateToken, async (req, res) => {
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

        // 获取活动标题用于通知
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

        // 报名成功发送通知
        await createNotification(studentId, 'activity_join', activityId, `您已成功报名活动“${activityTitle}”，请准时参加。`);

        sendResponse(res, true, null, '报名成功！');
    } catch (err) {
        console.error('活动报名失败：', err);
        sendResponse(res, false, null, '报名失败：' + err.message, 500);
    }
});

app.post('/api/activity/cancel', authenticateToken, async (req, res) => {
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

app.get('/api/my/activity', authenticateToken, async (req, res) => {
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

app.post('/api/activity', authenticateToken, validate([
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
            [data.title, data.content, data.activity_time, volunteerHours, 'pending']  // 默认状态
        );
        sendResponse(res, true, { id: result.insertId }, '新增活动成功！');
    } catch (err) {
        console.error('新增活动失败：', err);
        sendResponse(res, false, null, '新增活动失败：' + err.message, 500);
    }
});

app.put('/api/activity/:id', authenticateToken, validate([
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
            // 更新活动信息，使用 volunteer_hours 列
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
                    // 给用户增加志愿时长（user 表中的 volunteerTime 列）
                    // 同时增加活跃度，活跃度 = 志愿时长 × 5
                    await pool.execute(
                        'UPDATE user SET volunteerTime = volunteerTime + ?, activeScore = activeScore + ? * 5, lastActiveTime = ? WHERE id = ?',
                        [volunteerHours, volunteerHours, getNowTime(), userId]
                    );
                    await createNotification(
                        userId,
                        'activity_end',
                        id,
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

app.delete('/api/activity/:id', authenticateToken, async (req, res) => {
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

app.get('/api/activity/:id/participants', authenticateToken, async (req, res) => {
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

// ====================== 19. 图片上传接口 ======================
app.post('/api/upload/image', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return sendResponse(res, false, null, '请选择要上传的图片', 400);
        }

        const file = req.file;
        let imageUrl = '';

        if (useOSS && ossClient) {
            const fileName = `pets/${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.originalname}`;
            await ossClient.put(fileName, file.buffer);
            imageUrl = `https://${ossClient.options.bucket}.${ossClient.options.region}.aliyuncs.com/${fileName}`;
        } else {
            const fileName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.originalname}`;
            const filePath = path.join(uploadDir, fileName);
            fs.writeFileSync(filePath, file.buffer);
            imageUrl = `${BASE_URL}/uploads/${fileName}`;
        }

        sendResponse(res, true, { imageUrl }, '图片上传成功！');
    } catch (err) {
        console.error('上传图片失败：', err);
        sendResponse(res, false, null, '上传图片失败：' + err.message, 500);
    }
});

// ====================== 20. 学生登录接口 ======================
app.post('/api/student/login', validate([
    body('studentId').trim().notEmpty().withMessage('学号不能为空'),
    body('password').trim().notEmpty().withMessage('密码不能为空')
]), async (req, res) => {
    try {
        const { studentId, password } = req.body;

        const [students] = await pool.execute(
            'SELECT * FROM user WHERE studentId = ?',
            [studentId]
        );

        if (students.length === 0) {
            return sendResponse(res, false, null, '学号不存在', 400);
        }

        const student = students[0];
        // 检查用户是否有密码，如果没有，设置一个默认密码
        if (!student.password) {
            const defaultPassword = studentId;
            const hashedPassword = await bcrypt.hash(defaultPassword, 10);
            await pool.execute('UPDATE user SET password = ? WHERE id = ?', [hashedPassword, student.id]);
            // 重新获取用户信息
            const [updatedStudents] = await pool.execute('SELECT * FROM user WHERE studentId = ?', [studentId]);
            if (updatedStudents.length > 0) {
                student.password = updatedStudents[0].password;
            }
        }

        const isPwdCorrect = await bcrypt.compare(password, student.password);
        if (!isPwdCorrect) {
            return sendResponse(res, false, null, '密码错误', 400);
        }

        // 登录时增加活跃度 +1
        await pool.execute(
            'UPDATE user SET activeScore = activeScore + 1, loginCount = loginCount + 1, lastLoginTime = ?, lastActiveTime = ? WHERE studentId = ?',
            [getNowTime(), getNowTime(), studentId]
        );

        const token = jwt.sign(
            {
                id: student.id,
                studentId: student.studentId,
                name: student.name,
                major: student.major,
                role: student.role
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        return sendResponse(res, true, {
            id: student.id,
            studentId: student.studentId,
            name: student.name,
            major: student.major,
            role: student.role,
            avatarUrl: student.avatar_url || '',
            token: token
        }, '学生登录成功');
    } catch (err) {
        console.error('登录报错:', err);
        return sendResponse(res, false, null, '登录失败', 500);
    }
});

// ====================== 21. 学生修改密码接口 ======================
app.post('/api/student/change-password', authenticateToken, validate([
    body('oldPassword').trim().notEmpty().withMessage('旧密码不能为空'),
    body('newPassword').trim().notEmpty().withMessage('新密码不能为空')
]), async (req, res) => {
    try {
        const userId = req.user.id;
        const { oldPassword, newPassword } = req.body;

        const [users] = await pool.execute(
            'SELECT * FROM user WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return sendResponse(res, false, null, '用户不存在', 400);
        }

        const user = users[0];
        const isOldPwdCorrect = await bcrypt.compare(oldPassword, user.password);
        if (!isOldPwdCorrect) {
            return sendResponse(res, false, null, '旧密码不正确', 400);
        }

        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        await pool.execute(
            'UPDATE user SET password = ? WHERE id = ?',
            [newPasswordHash, userId]
        );

        return sendResponse(res, true, null, '密码修改成功');
    } catch (err) {
        console.error('学生修改密码报错:', err.stack);
        return sendResponse(res, false, null, '修改密码失败：' + err.message, 500);
    }
});

// ====================== 22. 通知接口（仅获取列表，无已读标记） ======================
app.get('/api/notifications', authenticateToken, async (req, res) => {
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

// ====================== 23. 主页图表数据接口 ======================
app.get('/api/home/chart-data', authenticateToken, async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();

        const [catsRows] = await pool.execute('SELECT * FROM cats');
        const [dogsRows] = await pool.execute('SELECT * FROM dogs');

        const cats = catsRows.map(item => underscoreToCamel(item));
        const dogs = dogsRows.map(item => underscoreToCamel(item));

        const calculateMonthlyAlive = (animals, year) => {
            const result = new Array(12).fill(0);
            for (let m = 0; m < 12; m++) {
                const monthEnd = new Date(year, m + 1, 0, 23, 59, 59, 999);
                result[m] = animals.filter(animal => {
                    const foundTime = animal.foundTime ? new Date(animal.foundTime) : null;
                    if (!foundTime || foundTime > monthEnd) return false;
                    const isDead = animal.isDead || animal.healthStatus === 'dead' || animal.healthStatus === '已死亡';
                    if (!isDead) return true;
                    const deadTime = animal.deadTime ? new Date(animal.deadTime) : null;
                    return !deadTime || deadTime > monthEnd;
                }).length;
            }
            return result;
        };

        const calculateHealthStatus = (cats, dogs) => {
            const counts = { normal: 0, attention: 0, emergency: 0, dead: 0 };
            const allAnimals = [...cats, ...dogs];
            allAnimals.forEach(animal => {
                const status = animal.healthStatus;
                if (status === 'normal' || status === '健康') counts.normal += 1;
                else if (status === 'attention' || status === '需要关注') counts.attention += 1;
                else if (status === 'emergency' || status === '紧急') counts.emergency += 1;
                else if (status === 'dead' || status === '已死亡' || animal.isDead) counts.dead += 1;
            });
            return counts;
        };

        const catMonthlyData = calculateMonthlyAlive(cats, currentYear);
        const dogMonthlyData = calculateMonthlyAlive(dogs, currentYear);
        const healthStatusData = calculateHealthStatus(cats, dogs);

        sendResponse(res, true, {
            catMonthlyData,
            dogMonthlyData,
            healthStatusData,
            currentYear,
            cats,
            dogs
        });
    } catch (err) {
        console.error('获取主页图表数据失败：', err);
        sendResponse(res, false, null, '获取主页图表数据失败：' + err.message, 500);
    }
});

// ====================== 24. 物资图表数据接口 ======================
app.get('/api/materials/chart-data', authenticateToken, async (req, res) => {
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

        sendResponse(res, true, {
            pieData,
            barData: {
                categories,
                quantityData,
                minStockData
            }
        });
    } catch (err) {
        console.error('获取物资图表数据失败：', err);
        sendResponse(res, false, null, '获取物资图表数据失败：' + err.message, 500);
    }
});

// ====================== 25. 志愿时长排行榜接口 ======================
app.get('/api/volunteer/ranking', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT studentId, name, volunteerTime FROM user ORDER BY volunteerTime DESC LIMIT 10'
        );
        const data = rows.map(item => underscoreToCamel(item));
        sendResponse(res, true, data);
    } catch (err) {
        console.error('获取志愿时长排行榜失败：', err);
        sendResponse(res, false, null, '获取志愿时长排行榜失败', 500);
    }
});
// ====================== 【学生头像上传 + AI自动审核 + 违规自动删除】 ======================
app.post('/api/student/upload/avatar', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return sendResponse(res, false, null, '请选择头像图片', 400);
        }

        const file = req.file;
        let imageUrl = '';
        let fileName = '';
        // 1. 上传到 OSS / 本地
        if (useOSS && ossClient) {
            fileName = `avatars/${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.originalname}`;
            await ossClient.put(fileName, file.buffer);
            imageUrl = `https://${ossClient.options.bucket}.${ossClient.options.region}.aliyuncs.com/${fileName}`;
        } else {
            fileName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.originalname}`;
            const filePath = path.join(uploadDir, fileName);
            fs.writeFileSync(filePath, file.buffer);
            imageUrl = `${BASE_URL}/uploads/${fileName}`;
        }

        // 2. AI 自动审核
        const check = await auditAvatarImage(imageUrl);

        // 3. 审核不通过 -> 删除已上传的文件并返回错误
        if (!check.pass) {
            try {
                if (useOSS && ossClient && fileName) {
                    await ossClient.delete(fileName);
                    console.log(`已删除违规头像 OSS 文件：${fileName}`);
                } else if (!useOSS && fs.existsSync(path.join(uploadDir, fileName))) {
                    fs.unlinkSync(path.join(uploadDir, fileName));
                    console.log(`已删除违规头像本地文件：${fileName}`);
                }
            } catch (delErr) {
                console.error('删除违规图片失败（不影响主流程）:', delErr);
            }
            const failMsg = check.description || '图片违规，请重新上传';
            return sendResponse(
                res,
                false,
                { label: check.label, description: check.description },
                failMsg,
                400
            );
        }

        // 4. 审核通过 → 更新数据库中的头像URL
        await pool.execute(
            'UPDATE user SET avatar_url = ? WHERE id = ?',
            [imageUrl, req.user.id]
        );

        sendResponse(res, true, { avatarUrl: imageUrl }, '头像上传并审核通过');
    } catch (err) {
        console.error('头像上传失败：', err);
        sendResponse(res, false, null, '头像上传失败：' + err.message, 500);
    }
});
// ====================== 启动服务 ======================
app.listen(port, () => {
    console.log(`✅ 后端服务已启动：http://localhost:${port}`);
});

// 测试 OSS 连接
async function testOSS() {
    if (useOSS && ossClient) {
        try {
            const result = await ossClient.list();
            console.log('✅ OSS 连接成功！');
        } catch (err) {
            console.error('❌ OSS 连接失败：', err);
        }
    } else {
        console.log('⚠️  OSS 配置未设置，使用本地存储');
    }
}
testOSS();
console.log('🔥 当前运行的 server.js 版本包含活跃度排行榜路由');