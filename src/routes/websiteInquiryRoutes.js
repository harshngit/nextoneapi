/**
 * websiteInquiryRoutes.js — Nextone Reality
 * Public "Contact Us" capture (no auth on create) + staff triage/convert.
 */

const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const ctrl = require("../controllers/websiteInquiryController");

const ADMIN = ["super_admin", "admin"];

/**
 * @swagger
 * tags:
 *   name: Website Inquiries
 *   description: >
 *     Public "Contact Us" form submissions from the website. Creating an
 *     inquiry needs NO authentication (the website has no logged-in user).
 *     Every other operation is staff-only.
 */

/**
 * @swagger
 * /api/v1/website-inquiries:
 *   post:
 *     summary: Submit a website inquiry (PUBLIC — no auth required)
 *     description: >
 *       Used by the public website's general "Contact Us" form. Anyone can
 *       call this without a Bearer token.
 *     tags: [Website Inquiries]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone]
 *             properties:
 *               name:         { type: string, example: "Rajesh Patel" }
 *               phone:        { type: string, example: "9876543210" }
 *               email:        { type: string, example: "rajesh@example.com" }
 *               message:      { type: string, example: "Interested in 2BHK options in Andheri" }
 *               project_id:   { type: string, format: uuid, description: "Optional — UUID or exact project name" }
 *               project_name: { type: string, description: "Optional free-text project name" }
 *               source:       { type: string, example: "Website", description: "Defaults to 'Website'" }
 *     responses:
 *       201:
 *         description: Inquiry received
 *       400:
 *         description: name and phone are required
 */
router.post("/", ctrl.createInquiry);

/**
 * @swagger
 * /api/v1/website-inquiries:
 *   get:
 *     summary: List website inquiries
 *     tags: [Website Inquiries]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [new, contacted, converted, spam, closed] }
 *       - in: query
 *         name: source
 *         schema: { type: string }
 *       - in: query
 *         name: project
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: per_page
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Website inquiries list returned
 */
router.get("/", authenticate, ctrl.getAllInquiries);

/**
 * @swagger
 * /api/v1/website-inquiries/{id}:
 *   get:
 *     summary: Get a website inquiry by id
 *     tags: [Website Inquiries]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Website inquiry returned
 *       404:
 *         description: Website inquiry not found
 */
router.get("/:id", authenticate, ctrl.getInquiryById);

/**
 * @swagger
 * /api/v1/website-inquiries/{id}:
 *   put:
 *     summary: Update a website inquiry
 *     description: Edit contact details, message, project, or mark status (contacted / spam / closed).
 *     tags: [Website Inquiries]
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
 *             properties:
 *               name:         { type: string }
 *               phone:        { type: string }
 *               email:        { type: string }
 *               message:      { type: string }
 *               status:       { type: string, enum: [new, contacted, converted, spam, closed] }
 *               project_id:   { type: string, format: uuid }
 *               project_name: { type: string }
 *     responses:
 *       200:
 *         description: Website inquiry updated
 *       404:
 *         description: Website inquiry not found
 */
router.put("/:id", authenticate, ctrl.updateInquiry);

/**
 * @swagger
 * /api/v1/website-inquiries/{id}/convert:
 *   post:
 *     summary: Convert a website inquiry into a Lead, Follow-up, or Site Visit
 *     description: >
 *       Always creates a Lead. When convert_to is "follow_up" or
 *       "site_visit", a Task / Site Visit is additionally created and
 *       linked to that same lead.
 *     tags: [Website Inquiries]
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
 *             required: [convert_to]
 *             properties:
 *               convert_to:          { type: string, enum: [lead, follow_up, site_visit] }
 *               assigned_to:         { type: string, format: uuid }
 *               budget:              { type: string }
 *               location_preference: { type: string }
 *               configuration:       { type: string }
 *               status:              { type: string, description: "Override the lead's default status" }
 *               project_id:          { type: string, format: uuid, description: "Override the inquiry's project" }
 *               project_name:        { type: string }
 *               title:               { type: string, description: "Follow-up only" }
 *               due_date:            { type: string, format: date-time, description: "Required for follow_up" }
 *               priority:            { type: string, enum: [low, medium, high], description: "Follow-up only" }
 *               notes:               { type: string }
 *               visit_date:          { type: string, format: date, description: "Required for site_visit" }
 *               visit_time:          { type: string, description: "Required for site_visit" }
 *               transport_arranged:  { type: boolean }
 *           example:
 *             convert_to: "site_visit"
 *             visit_date: "2026-07-20"
 *             visit_time: "11:00"
 *     responses:
 *       201:
 *         description: Inquiry converted
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Inquiry converted to site visit successfully"
 *               data:
 *                 lead: { id: "lead-uuid", name: "Rajesh Patel", status: "site_visit_scheduled" }
 *                 task: null
 *                 site_visit: { id: "sv-uuid", visit_date: "2026-07-20", visit_time: "11:00" }
 *       400:
 *         description: Missing required fields, or already converted
 *       404:
 *         description: Website inquiry not found
 */
router.post("/:id/convert", authenticate, ctrl.convertInquiry);

/**
 * @swagger
 * /api/v1/website-inquiries/{id}:
 *   delete:
 *     summary: Delete a website inquiry (Admin / Super Admin only)
 *     tags: [Website Inquiries]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Website inquiry deleted
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Website inquiry not found
 */
router.delete("/:id", authenticate, authorize(...ADMIN), ctrl.deleteInquiry);

module.exports = router;
