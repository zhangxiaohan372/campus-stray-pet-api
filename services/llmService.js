const axios = require('axios');

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
const LLM_MODEL = 'qwen-plus';
const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

/**
 * 调用 LLM（非流式）
 * @param {Array} messages - 消息列表
 * @param {string} model - 模型名称
 * @returns {Promise<string>} LLM 返回的文本
 */
async function callLLM(messages, model = LLM_MODEL) {
    const startTime = Date.now();

    if (!DASHSCOPE_API_KEY) {
        console.error('[LLM] ❌ 未配置 DASHSCOPE_API_KEY');
        throw new Error('未配置 DASHSCOPE_API_KEY');
    }

    try {
        const requestData = {
            model: model,
            messages: messages,
            temperature: 0.7,
            max_tokens: 2048,
            top_p: 0.8
        };

        console.log(`[LLM] 🚀 开始调用 LLM`);
        console.log(`[LLM] 📦 请求模型: ${model}`);
        console.log(`[LLM] 📝 请求消息数量: ${messages.length}`);
        console.log(`[LLM] 🔍 用户问题: ${messages[messages.length - 1]?.content?.substring(0, 100)}${messages[messages.length - 1]?.content?.length > 100 ? '...' : ''}`);

        const response = await axios.post(BASE_URL, requestData, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + DASHSCOPE_API_KEY
            }
        });

        const duration = Date.now() - startTime;
        const result = response.data;

        console.log(`[LLM] ✅ 调用成功`);
        console.log(`[LLM] ⏱️ 耗时: ${duration}ms`);
        console.log(`[LLM] 📊 HTTP状态码: ${response.status}`);

        if (result.choices && result.choices.length > 0) {
            const answer = result.choices[0].message.content;
            console.log(`[LLM] 🎯 回答内容: ${answer.substring(0, 150)}${answer.length > 150 ? '...' : ''}`);

            if (result.usage) {
                console.log(`[LLM] 💰 Token消耗: 输入=${result.usage.prompt_tokens || 0}, 输出=${result.usage.completion_tokens || 0}, 总计=${result.usage.total_tokens || 0}`);
            }
            return answer;
        }

        console.error(`[LLM] ❌ 响应格式错误: ${JSON.stringify(result)}`);
        throw new Error('LLM调用失败: 响应格式不正确');
    } catch (err) {
        const duration = Date.now() - startTime;
        const statusCode = err.response?.status || 'N/A';
        const errorData = err.response?.data || err.message;

        console.error(`[LLM] ❌ 调用失败`);
        console.error(`[LLM] ⏱️ 耗时: ${duration}ms`);
        console.error(`[LLM] 🚫 HTTP状态码: ${statusCode}`);
        console.error(`[LLM] 📋 错误信息: ${typeof errorData === 'object' ? JSON.stringify(errorData) : errorData}`);

        throw new Error('LLM调用失败: ' + (typeof errorData === 'object' ? JSON.stringify(errorData) : errorData));
    }
}

/**
 * 调用 LLM（流式），通过回调逐块返回
 * @param {Array} messages - 消息列表
 * @param {Function} onChunk - 每收到一个 chunk 时回调
 * @param {string} model - 模型名称
 * @returns {Promise<string>} 完整内容
 */
async function callLLMStream(messages, onChunk, model = LLM_MODEL) {
    const startTime = Date.now();

    if (!DASHSCOPE_API_KEY) {
        console.error('[LLM Stream] ❌ 未配置 DASHSCOPE_API_KEY');
        throw new Error('未配置 DASHSCOPE_API_KEY');
    }

    try {
        const requestData = {
            model: model,
            messages: messages,
            temperature: 0.7,
            max_tokens: 2048,
            top_p: 0.8,
            stream: true
        };

        console.log(`[LLM Stream] 🚀 开始流式调用 LLM`);
        console.log(`[LLM Stream] 📦 请求模型: ${model}`);
        console.log(`[LLM Stream] 📝 请求消息数量: ${messages.length}`);

        const response = await axios.post(BASE_URL, requestData, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + DASHSCOPE_API_KEY,
                'X-DashScope-SSE': 'enable'
            },
            responseType: 'stream'
        });

        return new Promise((resolve, reject) => {
            let fullContent = '';
            const stream = response.data;

            stream.on('data', (chunk) => {
                const chunkStr = chunk.toString();
                const lines = chunkStr.split('\n').filter(line => line.trim() !== '');

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const dataStr = line.substring(5).trim();
                        if (dataStr === '[DONE]') continue;
                        try {
                            const data = JSON.parse(dataStr);
                            if (data.choices && data.choices.length > 0) {
                                const delta = data.choices[0].delta;
                                if (delta && delta.content) {
                                    fullContent += delta.content;
                                    if (onChunk) {
                                        onChunk(delta.content);
                                    }
                                }
                            }
                        } catch (parseErr) {
                            console.error('[LLM Stream] 解析错误:', parseErr.message);
                        }
                    }
                }
            });

            stream.on('end', () => {
                const duration = Date.now() - startTime;
                console.log(`[LLM Stream] ✅ 流式调用完成`);
                console.log(`[LLM Stream] ⏱️ 耗时: ${duration}ms`);
                console.log(`[LLM Stream] 📝 完整内容长度: ${fullContent.length}`);
                resolve(fullContent);
            });

            stream.on('error', (err) => {
                console.error('[LLM Stream] ❌ 流式调用错误:', err.message);
                reject(err);
            });
        });
    } catch (err) {
        const duration = Date.now() - startTime;
        const statusCode = err.response?.status || 'N/A';
        const errorData = err.response?.data || err.message;

        console.error(`[LLM Stream] ❌ 调用失败`);
        console.error(`[LLM Stream] ⏱️ 耗时: ${duration}ms`);
        console.error(`[LLM Stream] 🚫 HTTP状态码: ${statusCode}`);
        console.error(`[LLM Stream] 📋 错误信息: ${typeof errorData === 'object' ? JSON.stringify(errorData) : errorData}`);

        throw new Error('LLM流式调用失败: ' + (typeof errorData === 'object' ? JSON.stringify(errorData) : errorData));
    }
}

module.exports = { callLLM, callLLMStream, DASHSCOPE_API_KEY };
