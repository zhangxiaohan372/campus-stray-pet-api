require('dotenv').config({ path: './.env' });
const pool = require('../config/db');

const PERMISSIONS = [
    { code: 'pet:read', name: '查看动物档案', module: 'pet', moduleName: '动物档案', desc: '允许查看流浪猫狗信息及健康状况' },
    { code: 'pet:write', name: '维护动物档案', module: 'pet', moduleName: '动物档案', desc: '允许新增、编辑、删除动物档案' },
    { code: 'point:read', name: '查看救助点', module: 'point', moduleName: '救助点', desc: '允许查看校园救助与投喂点位地图' },
    { code: 'point:write', name: '维护救助点', module: 'point', moduleName: '救助点', desc: '允许新增、更新、删除点位' },
    { code: 'material:read', name: '查看物资', module: 'material', moduleName: '物资管理', desc: '允许查看救助物资库存与申请列表' },
    { code: 'material:write', name: '维护物资', module: 'material', moduleName: '物资管理', desc: '允许新增、入库、出库与审核物资' },
    { code: 'user:read', name: '查看用户', module: 'user', moduleName: '用户管理', desc: '允许查看注册用户与志愿时长排行榜' },
    { code: 'user:write', name: '维护用户', module: 'user', moduleName: '用户管理', desc: '允许新增、编辑、删除用户档案及分配角色' },
    { code: 'announcement:read', name: '查看公告', module: 'announcement', moduleName: '公告管理', desc: '允许查看系统及社团通知' },
    { code: 'announcement:write', name: '维护公告', module: 'announcement', moduleName: '公告管理', desc: '允许发布、置顶、删除公告通知' },
    { code: 'activity:read', name: '查看活动', module: 'activity', moduleName: '志愿活动', desc: '允许查看志愿救助活动列表及详情' },
    { code: 'activity:join', name: '报名活动', module: 'activity', moduleName: '志愿活动', desc: '允许参与及报名志愿活动' },
    { code: 'activity:write', name: '维护活动', module: 'activity', moduleName: '志愿活动', desc: '允许创建、发布、审核与结算活动' },
    { code: 'ai:use', name: '使用 AI 助手', module: 'ai', moduleName: 'AI 助手', desc: '允许调用流浪动物问答大模型与知识检索' }
];

const ROLES = [
    { code: 'president', name: '社长', desc: '社团会长，拥有系统所有最高权限' },
    { code: 'admin', name: '管理员', desc: '社团核心骨干，负责宠物、物资、活动等系统日常管理' },
    { code: 'volunteer', name: '志愿者', desc: '注册认证志愿者，可参与活动报名、物资与动物信息查看' },
    { code: 'student', name: '普通学生', desc: '在校学生，可查阅流浪动物信息、参与活动与AI问答' }
];

const ROLE_PERMISSION_MAP = {
    president: PERMISSIONS.map(p => p.code),
    admin: [
        'pet:read', 'pet:write',
        'point:read', 'point:write',
        'material:read', 'material:write',
        'user:read', 'user:write',
        'announcement:read', 'announcement:write',
        'activity:read', 'activity:write', 'activity:join',
        'ai:use'
    ],
    volunteer: [
        'pet:read',
        'point:read',
        'material:read',
        'announcement:read',
        'activity:read',
        'activity:join',
        'ai:use'
    ],
    student: [
        'pet:read',
        'point:read',
        'material:read',
        'announcement:read',
        'activity:read',
        'activity:join',
        'ai:use'
    ]
};

async function initRBAC() {
    let connection;
    try {
        connection = await pool.getConnection();
        console.log('🔗 成功连接到数据库，正在执行 RBAC 表结构创建...');

        // 1. 创建 sys_permissions 表
        await connection.query(`
            CREATE TABLE IF NOT EXISTS \`sys_permissions\` (
              \`id\` INT AUTO_INCREMENT PRIMARY KEY,
              \`permission_code\` VARCHAR(64) NOT NULL UNIQUE COMMENT '权限字符，如 pet:read, material:write',
              \`permission_name\` VARCHAR(64) NOT NULL COMMENT '权限显示名称，如 查看动物档案',
              \`module\` VARCHAR(32) NOT NULL COMMENT '模块英文标识，如 pet, point, material',
              \`module_name\` VARCHAR(64) NOT NULL COMMENT '模块中文名称，如 动物档案, 物资管理',
              \`description\` VARCHAR(255) DEFAULT NULL COMMENT '权限说明',
              \`create_time\` DATETIME DEFAULT CURRENT_TIMESTAMP,
              INDEX \`idx_module\` (\`module\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='权限字符定义表';
        `);
        console.log('✅ sys_permissions 表创建完成');

        // 2. 创建 sys_roles 表
        await connection.query(`
            CREATE TABLE IF NOT EXISTS \`sys_roles\` (
              \`id\` INT AUTO_INCREMENT PRIMARY KEY,
              \`role_code\` VARCHAR(32) NOT NULL UNIQUE COMMENT '角色标识，如 president, admin, volunteer, student',
              \`role_name\` VARCHAR(64) NOT NULL COMMENT '角色名称，如 社长, 管理员, 志愿者, 学生',
              \`description\` VARCHAR(255) DEFAULT NULL COMMENT '角色描述',
              \`create_time\` DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统角色表';
        `);
        console.log('✅ sys_roles 表创建完成');

        // 3. 创建 sys_role_permissions 表
        await connection.query(`
            CREATE TABLE IF NOT EXISTS \`sys_role_permissions\` (
              \`id\` INT AUTO_INCREMENT PRIMARY KEY,
              \`role_id\` INT NOT NULL COMMENT '关联 sys_roles.id',
              \`permission_id\` INT NOT NULL COMMENT '关联 sys_permissions.id',
              \`create_time\` DATETIME DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY \`uk_role_permission\` (\`role_id\`, \`permission_id\`),
              INDEX \`idx_role_id\` (\`role_id\`),
              INDEX \`idx_permission_id\` (\`permission_id\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色权限关联表';
        `);
        console.log('✅ sys_role_permissions 表创建完成');

        // 4. 写入权限数据 (UPSERT)
        console.log('📥 正在初始化权限字符数据...');
        for (const p of PERMISSIONS) {
            await connection.execute(`
                INSERT INTO \`sys_permissions\` (\`permission_code\`, \`permission_name\`, \`module\`, \`module_name\`, \`description\`)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                    \`permission_name\` = VALUES(\`permission_name\`),
                    \`module\` = VALUES(\`module\`),
                    \`module_name\` = VALUES(\`module_name\`),
                    \`description\` = VALUES(\`description\`);
            `, [p.code, p.name, p.module, p.moduleName, p.desc]);
        }
        console.log(`✅ 成功初始化 ${PERMISSIONS.length} 个权限字符`);

        // 5. 写入角色数据 (UPSERT)
        console.log('📥 正在初始化系统角色数据...');
        for (const r of ROLES) {
            await connection.execute(`
                INSERT INTO \`sys_roles\` (\`role_code\`, \`role_name\`, \`description\`)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                    \`role_name\` = VALUES(\`role_name\`),
                    \`description\` = VALUES(\`description\`);
            `, [r.code, r.name, r.desc]);
        }
        console.log(`✅ 成功初始化 ${ROLES.length} 个系统角色`);

        // 6. 绑定角色与权限字符
        console.log('🔗 正在关联角色与权限字符...');
        const [roleRows] = await connection.execute('SELECT id, role_code FROM sys_roles');
        const [permRows] = await connection.execute('SELECT id, permission_code FROM sys_permissions');

        const roleMap = Object.fromEntries(roleRows.map(r => [r.role_code, r.id]));
        const permMap = Object.fromEntries(permRows.map(p => [p.permission_code, p.id]));

        for (const [roleCode, permCodes] of Object.entries(ROLE_PERMISSION_MAP)) {
            const roleId = roleMap[roleCode];
            if (!roleId) continue;

            for (const permCode of permCodes) {
                const permId = permMap[permCode];
                if (!permId) continue;

                await connection.execute(`
                    INSERT IGNORE INTO \`sys_role_permissions\` (\`role_id\`, \`permission_id\`)
                    VALUES (?, ?)
                `, [roleId, permId]);
            }
        }
        console.log('✅ 角色权限关联初始化完成！');

        // 7. 打印统计核验
        const [permCount] = await connection.query('SELECT COUNT(*) as c FROM sys_permissions');
        const [roleCount] = await connection.query('SELECT COUNT(*) as c FROM sys_roles');
        const [rpCount] = await connection.query('SELECT COUNT(*) as c FROM sys_role_permissions');

        console.log('\n📊 RBAC 初始化结果统计：');
        console.log(`- 权限字符数 (sys_permissions): ${permCount[0].c}`);
        console.log(`- 角色总数 (sys_roles): ${roleCount[0].c}`);
        console.log(`- 角色权限关联数 (sys_role_permissions): ${rpCount[0].c}`);

        process.exit(0);
    } catch (err) {
        console.error('❌ 初始化 RBAC 失败:', err);
        process.exit(1);
    } finally {
        if (connection) connection.release();
    }
}

initRBAC();
