const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');
const sendResponse = require('../utils/response');
const { underscoreToCamel } = require('../utils/caseConvert');

// ====================== 主页图表数据 ======================
router.get('/home/chart-data', authenticateToken, async (req, res) => {
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

        sendResponse(res, true, { catMonthlyData, dogMonthlyData, healthStatusData, currentYear, cats, dogs });
    } catch (err) {
        console.error('获取主页图表数据失败：', err);
        sendResponse(res, false, null, '获取主页图表数据失败：' + err.message, 500);
    }
});

// ====================== 志愿时长排行榜 ======================
router.get('/volunteer/ranking', authenticateToken, async (req, res) => {
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

// ====================== 学生统计数据 ======================
router.get('/student/stats', authenticateToken, async (req, res) => {
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

        sendResponse(res, true, { volunteerTime, postCount, activeScore }, '获取成功');
    } catch (err) {
        console.error('获取用户统计数据失败:', err);
        sendResponse(res, false, null, '获取统计数据失败', 500);
    }
});

module.exports = router;
