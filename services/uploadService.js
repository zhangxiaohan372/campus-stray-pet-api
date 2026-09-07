const path = require('path');
const fs = require('fs');
const { ossClient, useOSS } = require('../config/oss');
const { uploadDir } = require('../middleware/upload');

const BASE_URL = process.env.SERVER_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

/**
 * 上传文件到 OSS 或本地存储
 * @param {object} file - multer 文件对象
 * @param {string} subDir - 子目录名（如 'pets', 'avatars'）
 * @returns {Promise<{imageUrl: string, fileName: string}>}
 */
async function uploadFile(file, subDir = 'pets') {
    const randomStr = Math.random().toString(36).substr(2, 9);
    const fileName = `${subDir}/${Date.now()}-${randomStr}-${file.originalname}`;
    let imageUrl = '';

    if (useOSS && ossClient) {
        await ossClient.put(fileName, file.buffer);
        imageUrl = `https://${ossClient.options.bucket}.${ossClient.options.region}.aliyuncs.com/${fileName}`;
    } else {
        const localName = `${Date.now()}-${randomStr}-${file.originalname}`;
        const filePath = path.join(uploadDir, localName);
        fs.writeFileSync(filePath, file.buffer);
        imageUrl = `${BASE_URL}/uploads/${localName}`;
        return { imageUrl, fileName: localName };
    }

    return { imageUrl, fileName };
}

/**
 * 删除已上传的文件（审核不通过时）
 */
async function deleteFile(fileName) {
    try {
        if (useOSS && ossClient) {
            await ossClient.delete(fileName);
            console.log(`已删除 OSS 文件：${fileName}`);
        } else {
            const filePath = path.join(uploadDir, fileName);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`已删除本地文件：${fileName}`);
            }
        }
    } catch (err) {
        console.error('删除文件失败（不影响主流程）:', err);
    }
}

module.exports = { uploadFile, deleteFile };
