/**
 * 驼峰命名 → 下划线命名
 * 例：{ healthStatus: 'normal' } → { health_status: 'normal' }
 */
function camelToUnderscore(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    const newObj = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const newKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
            newObj[newKey] = obj[key];
        }
    }
    return newObj;
}

/**
 * 下划线命名 → 驼峰命名
 * 例：{ health_status: 'normal' } → { healthStatus: 'normal' }
 */
function underscoreToCamel(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    const newObj = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const newKey = key.replace(/(_\w)/g, (match) => match[1].toUpperCase());
            newObj[newKey] = obj[key];
        }
    }
    return newObj;
}

module.exports = { camelToUnderscore, underscoreToCamel };
