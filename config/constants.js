// 宠物名称匹配列表（用于意图识别）
const PET_NAME_PATTERNS = [
    '大黄', '大白', '小黑', '小花', '咪咪', '旺财', '小白',
    '小橘', '橘猫', '狸花', '奶牛', '三花', '布偶', '英短',
    '美短', '金毛', '柯基', '柴犬', '哈士奇', '拉布拉多',
    '泰迪', '博美', '比熊', '边牧'
];

// 健康状态映射
const HEALTH_STATUS_MAP = {
    'normal': '健康',
    'attention': '需要关注',
    'emergency': '紧急',
    'dead': '已离世'
};

// 健康状态 emoji
const HEALTH_EMOJI_MAP = {
    'normal': '✅',
    'attention': '⚠️',
    'emergency': '🚨',
    'dead': '💀'
};

function getHealthStatusText(status) {
    return HEALTH_STATUS_MAP[status] || status || '未知';
}

function getHealthEmoji(status) {
    return HEALTH_EMOJI_MAP[status] || '❓';
}

// 知识库内容
const KNOWLEDGE_BASE = [
    {
        content: '校园流浪动物管理系统功能：1. 小猫管理：查看、新增、编辑、删除小猫信息；2. 小狗管理：查看、新增、编辑、删除小狗信息；3. 学生管理：管理学生志愿者信息；4. 物资管理：管理动物所需物资库存；5. 志愿活动：发布和管理志愿活动；6. 公告管理：发布系统公告；7. 校园地图：查看动物救助点位置',
        category: '系统功能'
    },
    {
        content: '太原理工大学创建于1902年，前身是山西大学堂西学专斋，是中国最早的三所国立大学之一',
        category: '校史'
    },
    {
        content: '太原理工大学是国家"双一流"、"211工程"、"985工程"重点建设高校',
        category: '校史'
    },
    {
        content: '太原理工大学位于山西省太原市，现有明向、迎西、虎峪、柏林等多个校区',
        category: '校史'
    },
    {
        content: '校园流浪动物管理系统致力于为校园内的流浪猫和流浪狗提供救助和管理服务',
        category: '系统功能'
    },
    {
        content: '系统提供宠物健康状态管理，包括健康、需要关注、紧急等状态',
        category: '系统功能'
    },
];

// 系统功能描述（模板回答用）
const SYSTEM_FEATURES_TEXT = '校园流浪动物管理系统功能介绍：\n\n' +
    '1. 小猫管理：查看、新增、编辑、删除小猫信息，记录健康状态\n' +
    '2. 小狗管理：查看、新增、编辑、删除小狗信息，记录健康状态\n' +
    '3. 学生管理：管理学生志愿者信息和志愿时长\n' +
    '4. 物资管理：管理猫粮、狗粮等物资库存\n' +
    '5. 志愿活动：发布和管理救助志愿活动\n' +
    '6. 公告管理：发布系统公告通知\n' +
    '7. 校园地图：查看动物救助点位置';

const SCHOOL_HISTORY_TEXT = '太原理工大学校史：\n\n' +
    '太原理工大学创建于1902年，前身是山西大学堂西学专斋，是中国最早的三所国立大学之一。\n\n' +
    '学校是国家"双一流"、"211工程"、"985工程"重点建设高校，位于山西省太原市，现有明向、迎西、虎峪、柏林等多个校区。';

// 意图关键词
const KNOWLEDGE_KEYWORDS = ['如何', '怎么', '怎样', '方法', '建议', '技巧', '应该', '需要'];
const STATUS_KEYWORDS = ['状况', '状态', '怎么样', '如何'];
const FEATURE_KEYWORDS = ['功能', '介绍', '做什么'];
const COUNT_KEYWORDS = ['多少', '数量'];
const HISTORY_KEYWORDS = ['校史', '历史', '创建'];

module.exports = {
    PET_NAME_PATTERNS,
    HEALTH_STATUS_MAP,
    HEALTH_EMOJI_MAP,
    getHealthStatusText,
    getHealthEmoji,
    KNOWLEDGE_BASE,
    SYSTEM_FEATURES_TEXT,
    SCHOOL_HISTORY_TEXT,
    KNOWLEDGE_KEYWORDS,
    STATUS_KEYWORDS,
    FEATURE_KEYWORDS,
    COUNT_KEYWORDS,
    HISTORY_KEYWORDS
};
