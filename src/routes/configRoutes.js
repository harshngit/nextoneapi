const express = require("express");
const router = express.Router();
const configController = require("../controllers/configController");
const { authenticate, authorize } = require("../middleware/auth");

// System Configuration routes — intentionally excluded from Swagger docs

router.get(
  "/roles",
  authenticate,
  authorize("super_admin", "admin"),
  configController.getRoles
);

router.put(
  "/roles/:role",
  authenticate,
  authorize("super_admin", "admin"),
  configController.updateRolePermissions
);

router.get(
  "/lead-sources",
  authenticate,
  configController.getLeadSources
);

router.post(
  "/lead-sources",
  authenticate,
  authorize("super_admin", "admin"),
  configController.createLeadSource
);

router.put(
  "/lead-sources/:id",
  authenticate,
  authorize("super_admin", "admin"),
  configController.updateLeadSource
);

router.delete(
  "/lead-sources/:id",
  authenticate,
  authorize("super_admin", "admin"),
  configController.deleteLeadSource
);

router.get(
  "/modules",
  authenticate,
  authorize("super_admin", "admin"),
  configController.getModules
);

router.get(
  "/general",
  authenticate,
  authorize("super_admin", "admin"),
  configController.getGeneralSettings
);

router.put(
  "/general",
  authenticate,
  authorize("super_admin"),
  configController.updateGeneralSettings
);

router.get(
  "/audit-log",
  authenticate,
  authorize("super_admin"),
  configController.getAuditLog
);

module.exports = router;