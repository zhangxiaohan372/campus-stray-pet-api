const axios = require('axios');
const pool = require('../config/db');
const { underscoreToCamel } = require('../utils/caseConvert');
const cosineSimilarity = require('../utils/similarity');
const { callLLM } = require('./llmService');
const {
    PET_NAME_PATTERNS, getHealthStatusText,
    KNOWLEDGE_BASE, SYSTEM_FEATURES_TEXT, SCHOOL_HISTORY_TEXT,
    KNOWLEDGE_KEYWORDS, STATUS_KEYWORDS, FEATURE_KEYWORDS,
    COUNT_KEYWORDS, HISTORY_KEYWORDS
} = require('../config/constants');

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-v4';
const EMBEDDING_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings';

// 内存中的向量存储
let petVectors = [];

// ====================== 向量初始化 ======================

async function initializePetVectors() {
    if (!DASHSCOPE_API_KEY) {
        console.log('⚠️ DashScope API Key 未配置，跳过向量初始化');
        return;
    }

    try {
        const [catsResult] = await pool.execute('SELECT * FROM cats');
        const [dogsResult] = await pool.execute('SELECT * FROM dogs');

        const cats = (catsResult || []).map(cat => ({ ...underscoreToCamel(cat), type: 'cat' }));
        const dogs = (dogsResult || []).map(dog => ({ ...underscoreToCamel(dog), type: 'dog' }));

        petVectors = [];

        for (const pet of [...cats, ...dogs]) {
            const text = formatPetToText(pet);
            try {
                const embedding = await generateEmbedding(text);
                petVectors.push({ pet, text, embedding });
                console.log(`✅ 已生成向量: ${pet.name}`);
            } catch (err) {
                console.error(`生成 ${pet.name} 向量失败:`, err.message);
            }
        }

        console.log(`✅ 宠物向量初始化完成，共 ${petVectors.length} 条`);
    } catch (err) {
        console.error('宠物向量初始化失败:', err.message);
    }
}

// ====================== 格式化 ======================

function formatPetToText(pet) {
    const emoji = pet.type === 'cat' ? '猫' : '狗';

    return [
        `${pet.name || '未知'}是一只${pet.breed || '未知品种'}的${emoji}`,
        `健康状态：${getHealthStatusText(pet.healthStatus)}`,
        pet.health ? `健康详情：${pet.health}` : '',
        pet.area ? `活动区域：${pet.area}` : '',
        pet.age ? `年龄：${pet.age}` : '',
        pet.foundTime ? `发现时间：${pet.foundTime}` : ''
    ].filter(Boolean).join('。');
}

// ====================== 向量生成 ======================

async function generateEmbedding(text) {
    if (!DASHSCOPE_API_KEY) {
        throw new Error('未配置 DASHSCOPE_API_KEY');
    }

    try {
        const response = await axios.post(EMBEDDING_URL, {
            model: EMBEDDING_MODEL,
            input: text
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + DASHSCOPE_API_KEY
            }
        });

        if (response.data.data && response.data.data[0]) {
            return response.data.data[0].embedding;
        }

        throw new Error('嵌入生成失败: ' + JSON.stringify(response.data));
    } catch (err) {
        const errorMsg = err.response?.data || err.message;
        throw new Error('嵌入生成失败: ' + JSON.stringify(errorMsg));
    }
}

// ====================== 向量检索 ======================

async function retrieveSimilarPets(query, topK = 3) {
    if (!DASHSCOPE_API_KEY || petVectors.length === 0) {
        return [];
    }

    try {
        const queryEmbedding = await generateEmbedding(query);

        const results = petVectors.map(item => ({
            pet: item.pet,
            text: item.text,
            similarity: cosineSimilarity(queryEmbedding, item.embedding)
        }));

        results.sort((a, b) => b.similarity - a.similarity);

        return results.slice(0, topK);
    } catch (err) {
        console.error('向量检索失败:', err.message);
        return [];
    }
}

// ====================== 知识库搜索 ======================

function searchKnowledgeBase(query) {
    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 0);
    return KNOWLEDGE_BASE.filter(item => {
        const content = item.content.toLowerCase();
        return keywords.some(keyword => content.includes(keyword));
    }).map(item => item.content);
}

// ====================== 构建宠物名正则 ======================
function buildPetNameRegex() {
    return new RegExp(PET_NAME_PATTERNS.join('|').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

// ====================== 匹配宠物 ======================
function findMatchingPets(allPets, searchNames) {
    return allPets.filter(pet => {
        const petName = (pet.name || '').toLowerCase();
        const petBreed = (pet.breed || '').toLowerCase();
        return searchNames.some(name =>
            petName.includes(name) ||
            petBreed.includes(name) ||
            name.includes(petName) ||
            name.includes(petBreed)
        );
    });
}

function formatPetDetail(pet) {
    const healthText = getHealthStatusText(pet.healthStatus);
    return `${pet.name || '未知名称'}
品种：${pet.breed || '未知'}
年龄：${pet.age || '未知'}
健康状态：${healthText}
${pet.health ? '健康详情：' + pet.health : ''}
${pet.area ? '活动区域：' + pet.area : ''}
${pet.foundTime ? '发现时间：' + pet.foundTime : ''}`;
}

// ====================== 答案生成（核心） ======================

/**
 * 生成 AI 问答的回答（非流式）
 * 这里实现了意图识别 + 答案生成的完整 Agent 逻辑
 */
async function generateAnswer(query, relevantDocs, catsCount, dogsCount, allPets, similarPets) {
    const docText = relevantDocs.join('\n');
    const petNameRegex = buildPetNameRegex();
    const petNameMatch = query.match(petNameRegex);

    // 1. 查询特定宠物（按名称/品种）
    if (petNameMatch) {
        const searchNames = petNameMatch.map(n => n.toLowerCase());
        const matchedPets = findMatchingPets(allPets, searchNames);

        if (matchedPets.length > 0) {
            const petInfo = matchedPets.map(formatPetDetail).join('\n\n');
            return `找到了 ${matchedPets.length} 只相关的小动物：\n\n${petInfo}`;
        }
    }

    // 2. 查询宠物状况
    if (STATUS_KEYWORDS.some(k => query.includes(k))) {
        const searchNames = petNameMatch
            ? petNameMatch.map(n => n.toLowerCase())
            : [query.replace(petNameRegex, '').trim().toLowerCase()];

        if (searchNames.length && searchNames[0]) {
            const matchedPets = allPets.filter(pet => {
                const petName = (pet.name || '').toLowerCase();
                return searchNames.some(name => petName.includes(name));
            });

            if (matchedPets.length > 0) {
                const pet = matchedPets[0];
                const healthText = getHealthStatusText(pet.healthStatus);
                return `${pet.name || '未知名称'} 的状况：

品种：${pet.breed || '未知'}
年龄：${pet.age || '未知'}
健康状态：${healthText}
${pet.health ? '健康详情：' + pet.health : ''}
${pet.area ? '常出没区域：' + pet.area : ''}
${pet.foundTime ? '发现时间：' + pet.foundTime : ''}`;
            }
        }
    }

    // 3. 知识性问题 → 调 LLM
    const isKnowledgeQuestion = KNOWLEDGE_KEYWORDS.some(k => query.includes(k));
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
                { role: 'user', content: query }
            ];

            return await callLLM(messages);
        } catch (err) {
            console.error('LLM调用失败:', err.message);
        }
    }

    // 4. 向量检索结果（高匹配度）
    if (similarPets && similarPets.length > 0 && similarPets[0].similarity > 0.6) {
        const topPet = similarPets[0];
        const pet = topPet.pet;
        const healthText = getHealthStatusText(pet.healthStatus);

        return `${pet.name || '未知名称'} 的信息（匹配度：${Math.round(topPet.similarity * 100)}%）：

品种：${pet.breed || '未知'}
年龄：${pet.age || '未知'}
健康状态：${healthText}
${pet.health ? '健康详情：' + pet.health : ''}
${pet.area ? '活动区域：' + pet.area : ''}
${pet.foundTime ? '发现时间：' + pet.foundTime : ''}`;
    }

    // 5. 其他问题 → 尝试 LLM 兜底
    const isSimpleQuestion = FEATURE_KEYWORDS.concat(HISTORY_KEYWORDS).some(k => query.includes(k));
    if (!isSimpleQuestion) {
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
                    { role: 'user', content: query }
                ];

                return await callLLM(messages);
            } catch (err) {
                console.error('LLM调用失败，使用备用回答:', err.message);
                return docText || '抱歉，我暂时无法回答这个问题。您可以试试问：\n- "大黄的状况" - 查询特定宠物的信息\n- "小猫有多少只" - 查看小猫数量\n- "系统有什么功能" - 了解系统功能';
            }
        }
    }

    // 6. 规则匹配兜底
    if (FEATURE_KEYWORDS.some(k => query.includes(k))) {
        return SYSTEM_FEATURES_TEXT + '\n\n' + `当前系统共有 ${catsCount} 只小猫，${dogsCount} 只小狗`;
    } else if (query.includes('小猫') || query.includes('猫')) {
        return `当前系统共有 ${catsCount} 只小猫。\n\n系统支持对小猫进行管理，包括查看详细信息、上传照片、记录健康状态等功能。`;
    } else if (query.includes('小狗') || query.includes('狗')) {
        return `当前系统共有 ${dogsCount} 只小狗。\n\n系统支持对小狗进行管理，包括查看详细信息、上传照片、记录健康状态等功能。`;
    } else if (COUNT_KEYWORDS.some(k => query.includes(k))) {
        return `当前系统统计：\n- 小猫：${catsCount} 只\n- 小狗：${dogsCount} 只`;
    } else if (HISTORY_KEYWORDS.some(k => query.includes(k))) {
        return SCHOOL_HISTORY_TEXT;
    }

    return docText || '抱歉，我暂时无法回答这个问题。您可以试试问：\n- "大黄的状况" - 查询特定宠物的信息\n- "小猫有多少只" - 查看小猫数量\n- "系统有什么功能" - 了解系统功能';
}

module.exports = {
    initializePetVectors,
    formatPetToText,
    generateEmbedding,
    retrieveSimilarPets,
    searchKnowledgeBase,
    generateAnswer,
    getHealthStatusText
};
