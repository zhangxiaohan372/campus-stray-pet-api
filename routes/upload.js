const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const sendResponse = require('../utils/response');
const auditAvatarImage = require('../services/auditService');
const { uploadFile, deleteFile } = require('../services/uploadService');

// ====================== 通用图片上传 ======================
router.post('/upload/image', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return sendResponse(res, false, null, '请选择要上传的图片', 400);
        }

        const { imageUrl } = await uploadFile(req.file, 'pets');
        sendResponse(res, true, { imageUrl }, '图片上传成功！');
    } catch (err) {
        console.error('上传图片失败：', err);
        sendResponse(res, false, null, '上传图片失败：' + err.message, 500);
    }
});

// ====================== 学生头像上传 + AI 审核 ======================
router.post('/student/upload/avatar', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return sendResponse(res, false, null, '请选择头像图片', 400);
        }

        const { imageUrl, fileName } = await uploadFile(req.file, 'avatars');

        // AI 审核
        const check = await auditAvatarImage(imageUrl);

        if (!check.pass) {
            await deleteFile(fileName);
            const failMsg = check.description || '图片违规，请重新上传';
            return sendResponse(res, false, { label: check.label, description: check.description }, failMsg, 400);
        }

        // 审核通过，更新数据库
        await pool.execute('UPDATE user SET avatar_url = ? WHERE id = ?', [imageUrl, req.user.id]);

        sendResponse(res, true, { avatarUrl: imageUrl }, '头像上传并审核通过');
    } catch (err) {
        console.error('头像上传失败：', err);
        sendResponse(res, false, null, '头像上传失败：' + err.message, 500);
    }
});

module.exports = router;
