const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/holidayController')
const { authenticate, authorize } = require('../middleware/auth')

const ADMIN = ['super_admin', 'admin']

/**
 * @swagger
 * tags:
 *   name: Holidays
 *   description: >
 *     Admin/super_admin-defined holidays, targeted by role and/or specific user.
 *
 *     A holiday automatically writes/refreshes attendance rows for every targeted
 *     user on that date — `status: 'leave'`, `leave_type: 'holiday'` — so they are
 *     never marked absent. If the user checks in anyway, their check-in data is
 *     preserved and still tagged as a holiday.
 *
 *     **Targeting:** at least one of `roles` (role names, or `"all"` for everyone)
 *     or `user_ids` (specific individuals) is required — there is no implicit
 *     "applies to everyone" default.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/holidays:
 *   post:
 *     summary: Create a holiday (admin/super_admin only)
 *     description: >
 *       Creates a holiday for a date, targeted at one or more roles and/or specific users.
 *       Immediately writes `status:'leave', leave_type:'holiday'` attendance rows for every
 *       targeted active user on that date.
 *     tags: [Holidays]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date, name]
 *             properties:
 *               date:        { type: string, format: date, example: "2026-10-20" }
 *               name:        { type: string, example: "Diwali" }
 *               description: { type: string, example: "Festival of Lights — company holiday" }
 *               roles:
 *                 type: array
 *                 items: { type: string }
 *                 description: Role names, or "all" for every active role. Example for sales-only — ["sales_executive","external_caller","sales_manager"]
 *                 example: ["all"]
 *               user_ids:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *                 description: Specific users to also include, regardless of role.
 *                 example: []
 *     responses:
 *       201:
 *         description: Holiday created
 *       400:
 *         description: Missing date/name, or no target (roles and user_ids both empty), or invalid role
 *       403:
 *         description: Not admin/super_admin
 */
router.post('/', authenticate, authorize(...ADMIN), ctrl.createHoliday)

// ─────────────────────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/holidays:
 *   get:
 *     summary: List holidays
 *     description: >
 *       admin/super_admin see every holiday. Any other user sees only holidays that
 *       target their role (or "all") or their specific user_id.
 *     tags: [Holidays]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: year,          schema: { type: integer }, example: 2026 }
 *       - { in: query, name: month,         schema: { type: integer }, example: 10 }
 *       - { in: query, name: upcoming_only, schema: { type: boolean }, description: "Only holidays from today onward" }
 *       - { in: query, name: page,          schema: { type: integer, default: 1 } }
 *       - { in: query, name: per_page,      schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Paginated list of holidays
 */
router.get('/', authenticate, ctrl.getHolidays)

/**
 * @swagger
 * /api/v1/holidays/check:
 *   get:
 *     summary: Check if a date is a holiday for a user
 *     description: >
 *       Defaults to the calling user if `user_id` is not passed.
 *       Used by the frontend to show a "Today is a holiday" banner or to label a calendar cell.
 *     tags: [Holidays]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: date,    required: true, schema: { type: string, format: date } }
 *       - { in: query, name: user_id, schema: { type: string, format: uuid }, description: "admin only — check on behalf of another user" }
 *     responses:
 *       200:
 *         description: Holiday check result
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 date: "2026-10-20"
 *                 is_holiday: true
 *                 holidays: [{ id: "uuid", name: "Diwali" }]
 */
router.get('/check', authenticate, ctrl.checkHoliday)

/**
 * @swagger
 * /api/v1/holidays/{id}:
 *   get:
 *     summary: Get a single holiday by ID
 *     tags: [Holidays]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: Holiday fetched
 *       404:
 *         description: Holiday not found
 */
router.get('/:id', authenticate, ctrl.getHolidayById)

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE / DELETE (admin/super_admin only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/holidays/{id}:
 *   patch:
 *     summary: Update a holiday (admin/super_admin only)
 *     description: >
 *       Any field omitted from the body keeps its existing value.
 *       Re-syncs attendance rows for the new target list — reverts any attendance rows
 *       that were only holiday placeholders for the OLD target (i.e. no check-in happened),
 *       and writes fresh holiday rows for the NEW target.
 *     tags: [Holidays]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               date:        { type: string, format: date }
 *               name:        { type: string }
 *               description: { type: string }
 *               roles:
 *                 type: array
 *                 items: { type: string }
 *               user_ids:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Holiday updated
 *       400:
 *         description: Invalid role, or no target
 *       404:
 *         description: Holiday not found
 *       403:
 *         description: Not admin/super_admin
 */
router.patch('/:id', authenticate, authorize(...ADMIN), ctrl.updateHoliday)

/**
 * @swagger
 * /api/v1/holidays/{id}:
 *   delete:
 *     summary: Delete a holiday (admin/super_admin only)
 *     description: >
 *       Reverts attendance rows that were only holiday placeholders (no check-in) back
 *       to having no record at all. Rows where the user actually checked in are kept,
 *       just no longer tagged as a holiday (status reset to 'present').
 *     tags: [Holidays]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: Holiday deleted
 *       404:
 *         description: Holiday not found
 *       403:
 *         description: Not admin/super_admin
 */
router.delete('/:id', authenticate, authorize(...ADMIN), ctrl.deleteHoliday)

module.exports = router
