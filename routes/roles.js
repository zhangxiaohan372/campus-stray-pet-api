const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const sendResponse = require('../utils/response');
const { PERMISSIONS } = require('../config/permissions');
const {
    getAllRolesWithPermissions,
    getPermissionTree,
    updateRolePermissions
} = require('../services/permissionService');

// ====================== 获取所有角色及权限 ======================
router.get('/roles', authenticateToken, authorize(PERMISSIONS.USER_READ), async (req, res) => {
    try {
        const roles = await getAllRolesWithPermissions();
        sendResponse(res, true, roles, '获取角色权限列表成功');
    } catch (err) {
        console.error('获取角色权限列表失败:', err);
        sendResponse(res, false, null, '获取角色权限列表失败: ' + err.message, 500);
    }
});

// ====================== 获取所有系统权限树 ======================
router.get('/permissions/tree', authenticateToken, authorize(PERMISSIONS.USER_READ), async (req, res) => {
    try {
        const tree = await getPermissionTree();
        sendResponse(res, true, tree, '获取权限树成功');
    } catch (err) {
        console.error('获取权限树失败:', err);
        sendResponse(res, false, null, '获取权限树失败: ' + err.message, 500);
    }
});

// ====================== 修改指定角色的权限分配 ======================
router.put('/roles/:roleId/permissions', authenticateToken, authorize(PERMISSIONS.USER_WRITE), async (req, res) => {
    try {
        const roleId = parseInt(req.params.roleId);
        const { permissions = [] } = req.body;

        if (isNaN(roleId)) {
            return sendResponse(res, false, null, '无效的角色ID', 400);
        }

        if (!Array.isArray(permissions)) {
            return sendResponse(res, false, null, '权限列表必须为数组格式', 400);
        }

        await updateRolePermissions(roleId, permissions);
        sendResponse(res, true, null, '更新角色权限成功');
    } catch (err) {
        console.error('更新角色权限失败:', err);
        sendResponse(res, false, null, '更新角色权限失败: ' + err.message, 500);
    }
});

module.exports = router;
