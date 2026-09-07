const PERMISSIONS = {
    PET_READ: 'pet:read',
    PET_WRITE: 'pet:write',
    POINT_READ: 'point:read',
    POINT_WRITE: 'point:write',
    MATERIAL_READ: 'material:read',
    MATERIAL_WRITE: 'material:write',
    USER_READ: 'user:read',
    USER_WRITE: 'user:write',
    ANNOUNCEMENT_READ: 'announcement:read',
    ANNOUNCEMENT_WRITE: 'announcement:write',
    ACTIVITY_READ: 'activity:read',
    ACTIVITY_WRITE: 'activity:write',
    ACTIVITY_JOIN: 'activity:join',
    AI_USE: 'ai:use'
};

const ROLE_PERMISSIONS = {
    president: Object.values(PERMISSIONS),
    admin: [
        PERMISSIONS.PET_READ,
        PERMISSIONS.PET_WRITE,
        PERMISSIONS.POINT_READ,
        PERMISSIONS.POINT_WRITE,
        PERMISSIONS.MATERIAL_READ,
        PERMISSIONS.MATERIAL_WRITE,
        PERMISSIONS.USER_READ,
        PERMISSIONS.USER_WRITE,
        PERMISSIONS.ANNOUNCEMENT_READ,
        PERMISSIONS.ANNOUNCEMENT_WRITE,
        PERMISSIONS.ACTIVITY_READ,
        PERMISSIONS.ACTIVITY_WRITE,
        PERMISSIONS.ACTIVITY_JOIN,
        PERMISSIONS.AI_USE
    ],
    student: [
        PERMISSIONS.PET_READ,
        PERMISSIONS.POINT_READ,
        PERMISSIONS.MATERIAL_READ,
        PERMISSIONS.ANNOUNCEMENT_READ,
        PERMISSIONS.ACTIVITY_READ,
        PERMISSIONS.ACTIVITY_JOIN,
        PERMISSIONS.AI_USE
    ],
    volunteer: [
        PERMISSIONS.PET_READ,
        PERMISSIONS.POINT_READ,
        PERMISSIONS.MATERIAL_READ,
        PERMISSIONS.ANNOUNCEMENT_READ,
        PERMISSIONS.ACTIVITY_READ,
        PERMISSIONS.ACTIVITY_JOIN,
        PERMISSIONS.AI_USE
    ]
};

const PERMISSION_TREE = [
    {
        label: '动物档案',
        value: 'pet',
        children: [
            { label: '查看动物档案', value: PERMISSIONS.PET_READ },
            { label: '维护动物档案', value: PERMISSIONS.PET_WRITE }
        ]
    },
    {
        label: '救助点',
        value: 'point',
        children: [
            { label: '查看救助点', value: PERMISSIONS.POINT_READ },
            { label: '维护救助点', value: PERMISSIONS.POINT_WRITE }
        ]
    },
    {
        label: '物资管理',
        value: 'material',
        children: [
            { label: '查看物资', value: PERMISSIONS.MATERIAL_READ },
            { label: '维护物资', value: PERMISSIONS.MATERIAL_WRITE }
        ]
    },
    {
        label: '用户管理',
        value: 'user',
        children: [
            { label: '查看用户', value: PERMISSIONS.USER_READ },
            { label: '维护用户', value: PERMISSIONS.USER_WRITE }
        ]
    },
    {
        label: '公告管理',
        value: 'announcement',
        children: [
            { label: '查看公告', value: PERMISSIONS.ANNOUNCEMENT_READ },
            { label: '维护公告', value: PERMISSIONS.ANNOUNCEMENT_WRITE }
        ]
    },
    {
        label: '志愿活动',
        value: 'activity',
        children: [
            { label: '查看活动', value: PERMISSIONS.ACTIVITY_READ },
            { label: '报名活动', value: PERMISSIONS.ACTIVITY_JOIN },
            { label: '维护活动', value: PERMISSIONS.ACTIVITY_WRITE }
        ]
    },
    {
        label: 'AI 助手',
        value: 'ai',
        children: [
            { label: '使用 AI 助手', value: PERMISSIONS.AI_USE }
        ]
    }
];

function getPermissionsByRole(role) {
    return ROLE_PERMISSIONS[role] || [];
}

module.exports = {
    PERMISSIONS,
    ROLE_PERMISSIONS,
    PERMISSION_TREE,
    getPermissionsByRole
};
