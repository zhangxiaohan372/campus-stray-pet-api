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

// ====================== 阿里云内容安全（AI 图片审核） ======================
const GreenSDK = require("@alicloud/green20220302");
const GreenClient = GreenSDK.default;
const { ImageModerationRequest } = GreenSDK;
const { Config } = require("@alicloud/openapi-client");

let greenClient = null;
let useAudit = false;

try {
    const config = new Config({
        accessKeyId: process.env.OSS_ACCESS_KEY_ID,
        accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
        endpoint: "green.cn-shanghai.aliyuncs.com",
    });
    greenClient = new GreenClient(config);
    useAudit = true;
    console.log("✅ AI 图片审核已配置");
} catch (err) {
    console.error("AI 审核初始化失败:", err.message);
}

// 测试 OSS 连接
async function testOSS() {
    if (useOSS && ossClient) {
        try {
            await ossClient.list();
            console.log('✅ OSS 连接成功！');
        } catch (err) {
            console.error('❌ OSS 连接失败：', err);
        }
    } else {
        console.log('⚠️  OSS 配置未设置，使用本地存储');
    }
}

module.exports = {
    ossClient,
    useOSS,
    greenClient,
    useAudit,
    testOSS
};
