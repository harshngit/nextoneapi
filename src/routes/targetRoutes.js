/**
 * targetRoutes.js — Next One Realty CRM
 * Monthly performance targets (site visits + closures), per user.
 */

const express = require("express");
const router = express.Router();
const targetController = require("../controllers/targetController");
const { authenticate, authorize } = require("../middleware/auth");

/**
 * @swagger
 * tags:
 *   name: Targets
 *   description: >
 *     Monthly performance targets, per user. Every user defaults to
 *     15 site visits and 1 closure per month unless a custom target is set.
 *     "Remaining" is computed live from completed site visits and bookings
 *     (lead closures) — so closing a lead automatically reduces the
 *     remaining closure target, no manual update needed.
 */

/**
 * @swagger
 * /api/v1/targets:
 *   get:
 *     summary: List target progress for all visible users
 *     description: >
 *       Sales Executive sees only their own target. Sales Manager sees their
 *       team plus themselves. Admin / Super Admin see everyone.
 *       Defaults to the current month if `month` is not provided.
 *     tags: [Targets]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: string
 *           example: "2026-06"
 *         description: Target month in YYYY-MM format. Defaults to current month.
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter to a single user (still subject to role scoping)
 *     responses:
 *       200:
 *         description: Targets fetched
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 target_month: "2026-06"
 *                 targets:
 *                   - user_id: "user-uuid-001"
 *                     user_name: "Rahul Sharma"
 *                     role: "sales_executive"
 *                     target_month: "2026-06"
 *                     site_visit_target: 15
 *                     site_visits_done: 6
 *                     site_visits_remaining: 9
 *                     closure_target: 1
 *                     closures_done: 1
 *                     closures_remaining: 0
 *                     is_custom: false
 */
router.get("/", authenticate, targetController.getAllTargets);

/**
 * @swagger
 * /api/v1/targets/me:
 *   get:
 *     summary: Get my own target progress
 *     description: Shortcut for the logged-in user's own target/progress for a given month.
 *     tags: [Targets]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: string
 *           example: "2026-06"
 *     responses:
 *       200:
 *         description: Target fetched
 */
router.get("/me", authenticate, targetController.getMyTarget);

/**
 * @swagger
 * /api/v1/targets/{userId}:
 *   get:
 *     summary: Get one user's target progress
 *     description: >
 *       Sales Executive can only view their own. Sales Manager can view their
 *       team and themselves. Admin / Super Admin can view anyone.
 *     tags: [Targets]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: month
 *         schema:
 *           type: string
 *           example: "2026-06"
 *     responses:
 *       200:
 *         description: Target fetched
 *       403:
 *         description: Access denied
 *       404:
 *         description: User not found
 */
router.get("/:userId", authenticate, targetController.getUserTarget);

/**
 * @swagger
 * /api/v1/targets/{userId}:
 *   post:
 *     summary: Create / set a custom target for a user
 *     description: >
 *       Sets (upserts) a custom monthly target for a user, overriding the
 *       default 15 site visits / 1 closure. Admin and Super Admin can set
 *       targets for anyone; Sales Manager can only set targets for their
 *       own team members.
 *     tags: [Targets]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               month:
 *                 type: string
 *                 example: "2026-06"
 *                 description: Defaults to the current month if omitted.
 *               site_visit_target:
 *                 type: integer
 *                 example: 20
 *               closure_target:
 *                 type: integer
 *                 example: 2
 *     responses:
 *       201:
 *         description: Target set successfully
 *       403:
 *         description: Access denied
 *       404:
 *         description: User not found
 */
router.post(
  "/:userId",
  authenticate,
  authorize("super_admin", "admin", "sales_manager"),
  targetController.setUserTarget
);

/**
 * @swagger
 * /api/v1/targets/{userId}:
 *   put:
 *     summary: Update an existing custom target
 *     description: >
 *       Partially update a user's target for a given month (creates it if it
 *       doesn't exist yet). Same access rules as POST.
 *     tags: [Targets]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               month:
 *                 type: string
 *                 example: "2026-06"
 *               site_visit_target:
 *                 type: integer
 *                 example: 18
 *               closure_target:
 *                 type: integer
 *                 example: 2
 *     responses:
 *       200:
 *         description: Target updated successfully
 *       403:
 *         description: Access denied
 */
router.put(
  "/:userId",
  authenticate,
  authorize("super_admin", "admin", "sales_manager"),
  targetController.updateUserTarget
);

/**
 * @swagger
 * /api/v1/targets/{userId}:
 *   delete:
 *     summary: Reset a user's target back to default
 *     description: >
 *       Removes the custom target override for the given month, reverting
 *       the user back to the default 15 site visits / 1 closure.
 *     tags: [Targets]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: month
 *         schema:
 *           type: string
 *           example: "2026-06"
 *     responses:
 *       200:
 *         description: Target reset to default
 *       403:
 *         description: Access denied
 *       404:
 *         description: No custom target found — already at default
 */
router.delete(
  "/:userId",
  authenticate,
  authorize("super_admin", "admin", "sales_manager"),
  targetController.deleteUserTarget
);

module.exports = router;
