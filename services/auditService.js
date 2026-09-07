const { greenClient, useAudit } = require('../config/oss');

/**
 * AI 图片审核
 * @param {string} imageUrl - 图片 URL
 * @returns {Promise<{pass: boolean, riskLevel: string, label: string, description: string}>}
 */
async function auditAvatarImage(imageUrl) {
    if (!useAudit) return { pass: true, riskLevel: 'none', label: '', description: '' };

    const { ImageModerationRequest } = require("@alicloud/green20220302");

    try {
        const request = new ImageModerationRequest({
            service: "baselineCheck",
            serviceParameters: JSON.stringify({
                imageUrl: imageUrl,
                dataId: "avatar_" + Date.now(),
            }),
        });

        const res = await greenClient.imageModeration(request);
        const data = res?.body?.data;
        const riskLevel = data?.riskLevel || "none";

        const firstResult = data?.result?.[0] || {};
        const label = firstResult.label || "";
        const description = firstResult.description || "";

        const pass = (riskLevel === "none");

        console.log("[AI审核结果]", { riskLevel, label, description, pass });

        return { pass, riskLevel, label, description };
    } catch (err) {
        console.error("AI 审核出错：", err);
        return { pass: false, riskLevel: 'error', label: 'system_error', description: '审核服务异常' };
    }
}

module.exports = auditAvatarImage;
