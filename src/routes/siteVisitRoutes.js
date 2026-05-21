const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/siteVisitController');
const { authenticate, authorize } = require('../middleware/auth');

const ADMIN   = ['super_admin', 'admin'];
const MANAGER = ['super_admin', 'admin', 'sales_manager'];

/**
 * @swagger
 * tags:
 *   name: Site Visits
 *   description: Management of original site visits
 */

/**
 * @swagger
 * /api/v1/site-visits:
 *   get:
 *     summary: List all site visits (paginated, filterable)
 *     tags: [Site Visits]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [scheduled, done, cancelled, rescheduled, no_show] }
 *       - in: query
 *         name: lead_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: project_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: per_page
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Site visits list
 */
router.get('/', authenticate, ctrl.getAllSiteVisits);

/**
 * @swagger
 * /api/v1/site-visits:
 *   post:
 *     summary: Schedule a new site visit
 *     tags: [Site Visits]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lead_id, project_id, visit_date, visit_time]
 *             properties:
 *               lead_id: { type: string, format: uuid }
 *               project_id: { type: string, format: uuid }
 *               visit_date: { type: string, format: date }
 *               visit_time: { type: string }
 *     responses:
 *       201:
 *         description: Site visit scheduled
 */
router.post('/', authenticate, ctrl.createSiteVisit);

/**
 * @swagger
 * /api/v1/site-visits/{id}:
 *   get:
 *     summary: Get site visit details
 *     tags: [Site Visits]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Site visit details
 */
router.get('/:id', authenticate, ctrl.getSiteVisitById);

/**
 * @swagger
 * /api/v1/site-visits/{id}:
 *   put:
 *     summary: Update site visit
 *     tags: [Site Visits]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Site visit updated
 */
router.put('/:id', authenticate, ctrl.updateSiteVisit);

/**
 * @swagger
 * /api/v1/site-visits/{id}/status:
 *   patch:
 *     summary: Update site visit status
 *     tags: [Site Visits]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [scheduled, done, cancelled, rescheduled, no_show] }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: Status updated
 */
router.patch('/:id/status', authenticate, ctrl.updateSiteVisitStatus);

/**
 * @swagger
 * /api/v1/site-visits/{id}:
 *   delete:
 *     summary: Delete site visit
 *     tags: [Site Visits]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Site visit deleted
 */
router.delete('/:id', authenticate, authorize(...ADMIN), ctrl.deleteSiteVisit);

/**
 * @swagger
 * /api/v1/site-visits/{id}/feedback:
 *   post:
 *     summary: Submit feedback for site visit
 *     tags: [Site Visits]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Feedback submitted
 */
router.post('/:id/feedback', authenticate, ctrl.submitSiteVisitFeedback);

module.exports = router;
