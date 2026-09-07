const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');
const validate = require('../middleware/validate');
const sendResponse = require('../utils/response');
const { underscoreToCamel } = require('../utils/caseConvert');
const { getNowTime, delay } = require('../utils/time');
const createNotification = require('../services/notificationService');

// 点赞防抖并发锁
const processingLikes = new Map();

// ====================== 论坛热榜 ======================
router.get('/student/forum/hot', authenticateToken, async (req, res) => {
    try {
        let page = parseInt(req.query.page);
        let pageSize = parseInt(req.query.pageSize);
        if (isNaN(page) || page < 1) page = 1;
        if (isNaN(pageSize) || pageSize < 1) pageSize = 10;
        const offset = (page - 1) * pageSize;

        const [countRows] = await pool.execute('SELECT COUNT(*) as total FROM student_forum');
        const total = countRows[0].total;

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
            camelItem.commentCount = item.comment_count || 0;
            return camelItem;
        });

        sendResponse(res, true, { list: data, total, page, pageSize });
    } catch (err) {
        console.error('获取热榜失败:', err);
        sendResponse(res, false, null, '获取热榜失败', 500);
    }
});

// ====================== 论坛帖子列表 ======================
router.get('/student/forum', authenticateToken, async (req, res) => {
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

        sendResponse(res, true, { list: data, total, page, pageSize });
    } catch (err) {
        console.error('查询帖子失败：', err);
        sendResponse(res, false, null, '查询失败', 500);
    }
});

// ====================== 帖子详情 ======================
router.get('/student/forum/:postId', authenticateToken, async (req, res) => {
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

// ====================== 发帖 ======================
router.post('/student/forum', authenticateToken, validate([
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

// ====================== 我的帖子 ======================
router.get('/student/my/forum', authenticateToken, async (req, res) => {
    try {
        const studentNo = req.user.studentId;
        const [rows] = await pool.execute('SELECT * FROM student_forum WHERE student_no = ? ORDER BY id DESC', [studentNo]);
        sendResponse(res, true, rows.map(item => underscoreToCamel(item)));
    } catch (err) {
        sendResponse(res, false, null, '查询失败', 500);
    }
});

// ====================== 删除帖子 ======================
router.delete('/student/forum/:id', authenticateToken, async (req, res) => {
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

// ====================== 评论列表 ======================
router.get('/student/forum/:postId/comments', authenticateToken, async (req, res) => {
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

// ====================== 发表评论 ======================
router.post('/student/forum/:postId/comments', authenticateToken, validate([
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

// ====================== 我的评论 ======================
router.get('/student/my/comments', authenticateToken, async (req, res) => {
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

// ====================== 删除评论 ======================
router.delete('/student/forum/comments/:id', authenticateToken, async (req, res) => {
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

// ====================== 点赞/取消点赞 ======================
router.post('/student/forum/:postId/like', authenticateToken, async (req, res) => {
    const studentNo = req.user.studentId;
    const { postId } = req.params;

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
                await pool.execute('DELETE FROM like_record WHERE id = ?', [exist[0].id]);
                await pool.execute('UPDATE student_forum SET like_count = like_count - 1 WHERE id = ?', [postId]);
                return sendResponse(res, true, { isLiked: false }, '已取消点赞');
            } else {
                await pool.execute('INSERT INTO like_record (student_no, post_id) VALUES (?, ?)', [studentNo, postId]);
                await pool.execute('UPDATE student_forum SET like_count = like_count + 1 WHERE id = ?', [postId]);

                try {
                    const [post] = await pool.execute('SELECT author FROM student_forum WHERE id = ?', [postId]);
                    if (post.length) {
                        const postAuthor = post[0].author;
                        const [authorUser] = await pool.execute('SELECT id FROM user WHERE name = ? LIMIT 1', [postAuthor]);
                        if (authorUser.length) {
                            await createNotification(authorUser[0].id, 'like', postId, `${req.user.name} 点赞了你的帖子`);
                        }
                    }
                } catch (noticeErr) {
                    console.error('发送点赞通知失败（不影响主流程）:', noticeErr);
                }

                return sendResponse(res, true, { isLiked: true }, '点赞成功');
            }
        } catch (err) {
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

// ====================== 点赞状态 ======================
router.get('/student/forum/:postId/like/status', authenticateToken, async (req, res) => {
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

module.exports = router;
