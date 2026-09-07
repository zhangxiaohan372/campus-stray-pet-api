const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const sendResponse = require('../utils/response');
const { PERMISSIONS } = require('../config/permissions');
const { underscoreToCamel } = require('../utils/caseConvert');
const {
    searchKnowledgeBase,
    retrieveSimilarPets,
    generateAnswer
} = require('../services/ragService');
const { callLLMStream } = require('../services/llmService');
const {
    PET_NAME_PATTERNS, getHealthStatusText,
    SYSTEM_FEATURES_TEXT, SCHOOL_HISTORY_TEXT,
    KNOWLEDGE_KEYWORDS, STATUS_KEYWORDS, FEATURE_KEYWORDS,
    COUNT_KEYWORDS, HISTORY_KEYWORDS
} = require('../config/constants');

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;

// ====================== AI 非流式问答 ======================
router.post('/ai/qa', authenticateToken, authorize(PERMISSIONS.AI_USE), async (req, res) => {
    try {
        const { question } = req.body;

        if (!question) {
            return sendResponse(res, false, null, '请输入问题', 400);
        }

        const relevantDocs = searchKnowledgeBase(question);

        let similarPets = [];
        try {
            similarPets = await retrieveSimilarPets(question, 3);
            console.log(`[向量检索] 找到 ${similarPets.length} 个相关结果`);
        } catch (err) {
            console.log('[向量检索] 跳过（可能未配置）:', err.message);
        }

        const [catsResult] = await pool.execute('SELECT * FROM cats');
        const [dogsResult] = await pool.execute('SELECT * FROM dogs');

        const cats = (catsResult || []).map(cat => ({ ...underscoreToCamel(cat), type: 'cat' }));
        const dogs = (dogsResult || []).map(dog => ({ ...underscoreToCamel(dog), type: 'dog' }));

        const allPets = [...cats, ...dogs];
        const catsCount = cats.length;
        const dogsCount = dogs.length;

        const answer = await generateAnswer(question, relevantDocs, catsCount, dogsCount, allPets, similarPets);

        sendResponse(res, true, { answer }, '查询成功');
    } catch (err) {
        console.error('AI问答出错：', err);
        sendResponse(res, false, null, '查询失败：' + err.message, 500);
    }
});

// ====================== AI 流式问答（Agent 中间层入口） ======================
router.post('/ai/qa/stream', authenticateToken, authorize(PERMISSIONS.AI_USE), async (req, res) => {
    try {
        const { question } = req.body;

        if (!question) {
            return sendResponse(res, false, null, '请输入问题', 400);
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const relevantDocs = searchKnowledgeBase(question);
        const docText = relevantDocs.join('\n');

        let similarPets = [];
        try {
            similarPets = await retrieveSimilarPets(question, 3);
            console.log(`[向量检索] 找到 ${similarPets.length} 个相关结果`);
        } catch (err) {
            console.log('[向量检索] 跳过（可能未配置）:', err.message);
        }

        const [catsResult] = await pool.execute('SELECT * FROM cats');
        const [dogsResult] = await pool.execute('SELECT * FROM dogs');

        const cats = (catsResult || []).map(cat => ({ ...underscoreToCamel(cat), type: 'cat' }));
        const dogs = (dogsResult || []).map(dog => ({ ...underscoreToCamel(dog), type: 'dog' }));
        const allPets = [...cats, ...dogs];

        const catsCount = cats.length;
        const dogsCount = dogs.length;

        const isKnowledgeQuestion = KNOWLEDGE_KEYWORDS.some(k => question.includes(k));
        const isStatusQuestion = STATUS_KEYWORDS.some(k => question.includes(k));

        // 辅助函数：流式发送文本
        async function streamText(text) {
            for (const char of text) {
                res.write(`data: ${JSON.stringify({ type: 'chunk', content: char })}\n\n`);
            }
        }

        // 1. 宠物名匹配
        const petNameRegex = new RegExp(PET_NAME_PATTERNS.join('|'));
        const petNameMatch = question.match(petNameRegex);

        if (petNameMatch) {
            const searchNames = petNameMatch.map(n => n.toLowerCase());
            const matchedPets = allPets.filter(pet => {
                const petName = (pet.name || '').toLowerCase();
                const petBreed = (pet.breed || '').toLowerCase();
                return searchNames.some(name =>
                    petName.includes(name) || petBreed.includes(name) ||
                    name.includes(petName) || name.includes(petBreed)
                );
            });

            if (matchedPets.length > 0) {
                const petInfo = matchedPets.map(pet => {
                    const healthText = getHealthStatusText(pet.healthStatus);
                    return `${pet.name || '未知名称'}
品种：${pet.breed || '未知'}
年龄：${pet.age || '未知'}
健康状态：${healthText}
${pet.health ? '健康详情：' + pet.health : ''}
${pet.area ? '活动区域：' + pet.area : ''}
${pet.foundTime ? '发现时间：' + pet.foundTime : ''}`;
                }).join('\n\n');

                await streamText(`找到了 ${matchedPets.length} 只相关的小动物：\n\n${petInfo}`);
                res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
                res.end();
                return;
            }
        }

        // 2. 状态查询
        if (isStatusQuestion) {
            const searchNames = petNameMatch
                ? petNameMatch.map(n => n.toLowerCase())
                : [question.replace(petNameRegex, '').trim().toLowerCase()];

            if (searchNames.length && searchNames[0]) {
                const matchedPets = allPets.filter(pet => {
                    const petName = (pet.name || '').toLowerCase();
                    return searchNames.some(name => petName.includes(name));
                });

                if (matchedPets.length > 0) {
                    const pet = matchedPets[0];
                    const healthText = getHealthStatusText(pet.healthStatus);
                    const answer = `${pet.name || '未知名称'} 的状况：

品种：${pet.breed || '未知'}
年龄：${pet.age || '未知'}
健康状态：${healthText}
${pet.health ? '健康详情：' + pet.health : ''}
${pet.area ? '常出没区域：' + pet.area : ''}
${pet.foundTime ? '发现时间：' + pet.foundTime : ''}`;

                    await streamText(answer);
                    res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
                    res.end();
                    return;
                }
            }
        }

        // 3. 知识性问题 → 流式 LLM
        if (isKnowledgeQuestion && DASHSCOPE_API_KEY) {
            try {
                const context = docText ? `知识库信息：\n${docText}\n\n` : '';
                const systemPrompt = `你是一个校园流浪动物管理系统的智能助手。请基于提供的信息和你的知识回答问题。

系统统计数据：
- 小猫数量：${catsCount} 只
- 小狗数量：${dogsCount} 只

${context}
请用友好、专业的语气回答用户的问题。不要使用任何 emoji 表情符号。`;

                const messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: question }
                ];

                await callLLMStream(messages, (chunk) => {
                    res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
                });

                res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
                res.end();
                return;
            } catch (err) {
                console.error('[流式LLM] 调用失败:', err.message);
                res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
                res.end();
                return;
            }
        }

        // 4. 向量检索高匹配
        if (similarPets && similarPets.length > 0 && similarPets[0].similarity > 0.6) {
            const topPet = similarPets[0];
            const pet = topPet.pet;
            const healthText = getHealthStatusText(pet.healthStatus);

            const answer = `${pet.name || '未知名称'} 的信息（匹配度：${Math.round(topPet.similarity * 100)}%）：

品种：${pet.breed || '未知'}
年龄：${pet.age || '未知'}
健康状态：${healthText}
${pet.health ? '健康详情：' + pet.health : ''}
${pet.area ? '活动区域：' + pet.area : ''}
${pet.foundTime ? '发现时间：' + pet.foundTime : ''}`;

            await streamText(answer);
            res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
            res.end();
            return;
        }

        // 5. LLM 兜底
        if (DASHSCOPE_API_KEY) {
            try {
                const context = docText ? `知识库信息：\n${docText}\n\n` : '';
                const systemPrompt = `你是一个校园流浪动物管理系统的智能助手。请基于提供的信息和你的知识回答问题。

系统统计数据：
- 小猫数量：${catsCount} 只
- 小狗数量：${dogsCount} 只

${context}
请用友好、专业的语气回答用户的问题。不要使用任何 emoji 表情符号。`;

                const messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: question }
                ];

                await callLLMStream(messages, (chunk) => {
                    res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
                });

                res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
                res.end();
                return;
            } catch (err) {
                console.error('[流式LLM] 调用失败:', err.message);
            }
        }

        // 6. 规则匹配兜底
        let answer = '';
        if (FEATURE_KEYWORDS.some(k => question.includes(k))) {
            answer = SYSTEM_FEATURES_TEXT + '\n\n' + `当前系统共有 ${catsCount} 只小猫，${dogsCount} 只小狗`;
        } else if (question.includes('小猫') || question.includes('猫')) {
            answer = `当前系统共有 ${catsCount} 只小猫。\n\n系统支持对小猫进行管理，包括查看详细信息、上传照片、记录健康状态等功能。`;
        } else if (question.includes('小狗') || question.includes('狗')) {
            answer = `当前系统共有 ${dogsCount} 只小狗。\n\n系统支持对小狗进行管理，包括查看详细信息、上传照片、记录健康状态等功能。`;
        } else if (COUNT_KEYWORDS.some(k => question.includes(k))) {
            answer = `当前系统统计：\n- 小猫：${catsCount} 只\n- 小狗：${dogsCount} 只`;
        } else if (HISTORY_KEYWORDS.some(k => question.includes(k))) {
            answer = SCHOOL_HISTORY_TEXT;
        } else {
            answer = docText || '抱歉，我暂时无法回答这个问题。您可以试试问：\n- "大黄的状况" - 查询特定宠物的信息\n- "小猫有多少只" - 查看小猫数量\n- "系统有什么功能" - 了解系统功能';
        }

        await streamText(answer);
        res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
        res.end();

    } catch (err) {
        console.error('AI流式问答出错：', err);
        if (!res.headersSent) {
            res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
            res.end();
        }
    }
});

module.exports = router;
