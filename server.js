require('dotenv').config();

const app = require('./index');
const port = process.env.PORT || 3001;

app.listen(port, async () => {
    console.log(`✅ 后端服务已启动：http://localhost:${port}`);

    // 初始化宠物向量（文本嵌入 + 向量检索）
    const { initializePetVectors } = require('./services/ragService');
    await initializePetVectors();
});
