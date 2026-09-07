const sendResponse = require('../utils/response');
const { getPermissionsByRole } = require('../services/permissionService');

function authorize(requiredPermissions = []) {
    const permissions = Array.isArray(requiredPermissions)
        ? requiredPermissions
        : [requiredPermissions];

    return async (req, res, next) => {
        try {
            const role = req.user?.role;
            const grantedPermissions = await getPermissionsByRole(role);
            const allowed = permissions.every(permission => grantedPermissions.includes(permission));

            if (!allowed) {
                return sendResponse(res, false, null, '没有访问该资源的权限', 403);
            }

            req.permissions = grantedPermissions;
            next();
        } catch (err) {
            console.error('权限鉴权异常:', err);
            return sendResponse(res, false, null, '鉴权服务异常', 500);
        }
    };
}

module.exports = authorize;
