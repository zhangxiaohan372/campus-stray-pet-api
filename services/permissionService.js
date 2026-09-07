const pool = require('../config/db');
const { ROLE_PERMISSIONS: FALLBACK_ROLE_PERMISSIONS, PERMISSION_TREE: FALLBACK_TREE } = require('../config/permissions');

// 角色权限轻量内存缓存，默认缓存 60 秒
const roleCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

/**
 * 清除权限缓存
 */
function clearPermissionCache() {
    roleCache.clear();
}

/**
 * 根据角色标识获取其拥有的权限字符列表
 * @param {string} roleCode 角色标识（如 president, admin, volunteer, student）
 * @returns {Promise<string[]>} 权限字符数组
 */
async function getPermissionsByRole(roleCode) {
    if (!roleCode) return [];

    const now = Date.now();
    const cached = roleCache.get(roleCode);
    if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
        return cached.permissions;
    }

    try {
        const sql = `
            SELECT p.permission_code
            FROM sys_permissions p
            INNER JOIN sys_role_permissions rp ON p.id = rp.permission_id
            INNER JOIN sys_roles r ON rp.role_id = r.id
            WHERE r.role_code = ?
        `;
        const [rows] = await pool.execute(sql, [roleCode]);
        const permissions = rows.map(row => row.permission_code);

        // 如果数据库查到了，存入缓存并返回
        if (permissions.length > 0) {
            roleCache.set(roleCode, { permissions, timestamp: now });
            return permissions;
        }

        // 若数据库中无该角色记录，回退到兜底硬编码
        const fallback = FALLBACK_ROLE_PERMISSIONS[roleCode] || [];
        roleCache.set(roleCode, { permissions: fallback, timestamp: now });
        return fallback;
    } catch (err) {
        console.error(`[permissionService] 查询角色 [${roleCode}] 权限失败，降级使用兜底配置:`, err.message);
        return FALLBACK_ROLE_PERMISSIONS[roleCode] || [];
    }
}

/**
 * 获取所有权限列表并按业务模块组装为树形结构
 */
async function getPermissionTree() {
    try {
        const sql = `
            SELECT id, permission_code, permission_name, module, module_name, description
            FROM sys_permissions
            ORDER BY id ASC
        `;
        const [rows] = await pool.query(sql);

        if (!rows || rows.length === 0) {
            return FALLBACK_TREE;
        }

        const moduleMap = new Map();
        for (const row of rows) {
            if (!moduleMap.has(row.module)) {
                moduleMap.set(row.module, {
                    label: row.module_name || row.module,
                    value: row.module,
                    children: []
                });
            }
            moduleMap.get(row.module).children.push({
                id: row.id,
                label: row.permission_name,
                value: row.permission_code,
                description: row.description
            });
        }

        return Array.from(moduleMap.values());
    } catch (err) {
        console.error('[permissionService] 获取权限树失败，降级使用兜底配置:', err.message);
        return FALLBACK_TREE;
    }
}

/**
 * 获取所有角色及各自绑定的权限字符列表
 */
async function getAllRolesWithPermissions() {
    const sql = `
        SELECT 
            r.id, 
            r.role_code, 
            r.role_name, 
            r.description,
            r.create_time,
            GROUP_CONCAT(p.permission_code SEPARATOR ',') as permission_codes
        FROM sys_roles r
        LEFT JOIN sys_role_permissions rp ON r.id = rp.role_id
        LEFT JOIN sys_permissions p ON rp.permission_id = p.id
        GROUP BY r.id
        ORDER BY r.id ASC
    `;
    const [rows] = await pool.query(sql);
    return rows.map(row => ({
        id: row.id,
        roleCode: row.role_code,
        roleName: row.role_name,
        description: row.description,
        createTime: row.create_time,
        permissions: row.permission_codes ? row.permission_codes.split(',') : []
    }));
}

/**
 * 更新某个角色的权限字符列表
 * @param {number} roleId 角色 ID
 * @param {string[]} permissionCodes 权限字符数组
 */
async function updateRolePermissions(roleId, permissionCodes = []) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 检查角色是否存在
        const [roles] = await connection.execute('SELECT id, role_code FROM sys_roles WHERE id = ?', [roleId]);
        if (roles.length === 0) {
            throw new Error('指定角色不存在');
        }

        // 删除旧关联
        await connection.execute('DELETE FROM sys_role_permissions WHERE role_id = ?', [roleId]);

        // 插入新关联
        if (permissionCodes.length > 0) {
            // 查询对应的 permission_id
            const placeholders = permissionCodes.map(() => '?').join(',');
            const [perms] = await connection.query(
                `SELECT id, permission_code FROM sys_permissions WHERE permission_code IN (${placeholders})`,
                permissionCodes
            );

            for (const p of perms) {
                await connection.execute(
                    'INSERT INTO sys_role_permissions (role_id, permission_id) VALUES (?, ?)',
                    [roleId, p.id]
                );
            }
        }

        await connection.commit();
        // 清理缓存
        clearPermissionCache();
        return true;
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

module.exports = {
    getPermissionsByRole,
    getPermissionTree,
    getAllRolesWithPermissions,
    updateRolePermissions,
    clearPermissionCache
};
