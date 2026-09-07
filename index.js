const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const { testOSS } = require('./config/oss');
const securityHeaders = require('./middleware/securityHeaders');

const app = express();

// ====================== 全局中间件 ======================
const corsOptions = {
    origin: true,
    credentials: true
};
app.use(cors(corsOptions));
app.use(securityHeaders);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ====================== 静态文件 ======================
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ====================== 注册路由 ======================
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/cats'));
app.use('/api', require('./routes/dogs'));
app.use('/api', require('./routes/users'));
app.use('/api', require('./routes/materials'));
app.use('/api', require('./routes/points'));
app.use('/api', require('./routes/announcements'));
app.use('/api', require('./routes/forum'));
app.use('/api', require('./routes/activity'));
app.use('/api', require('./routes/notifications'));
app.use('/api', require('./routes/upload'));
app.use('/api', require('./routes/home'));
app.use('/api', require('./routes/ai'));
app.use('/api', require('./routes/roles'));

// ====================== 启动时检查 OSS ======================
testOSS();

console.log('🔥 当前运行的版本包含：路由分层架构 + 活跃度排行榜 + RAG智能问答');

module.exports = app;
