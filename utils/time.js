/**
 * 获取当前东八区时间字符串
 * @returns {string} 格式：YYYY-MM-DD HH:mm:ss
 */
function getNowTime() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 异步延迟
 * @param {number} ms - 延迟毫秒数
 */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { getNowTime, delay };
