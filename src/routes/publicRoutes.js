/**
 * publicRoutes.js — Nextone Reality
 * Public marketing-website endpoints — NO authentication anywhere in this file.
 */

const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/publicController");

/**
 * @swagger
 * tags:
 *   name: Public Website
 *   description: Public marketing-website endpoints — no authentication required.
 */

/**
 * @swagger
 * /api/v1/public/projects:
 *   get:
 *     summary: List projects for the public website (PUBLIC — no auth)
 *     description: >
 *       Returns marketing-safe project fields plus grouped media for each
 *       project (photos, videos, creatives, unit_plans, payment_plans,
 *       developer_logo) — same shape as GET /public/projects/{id}.
 *       Deactivated (inactive) projects are excluded.
 *     tags: [Public Website]
 *     parameters:
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *       - in: query
 *         name: location
 *         schema: { type: string }
 *         description: Filter by locality (partial match, e.g. "Andheri")
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by project name or developer
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: per_page
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Projects list returned
 */
router.get("/projects", ctrl.getPublicProjects);

/**
 * @swagger
 * /api/v1/public/projects/{id}:
 *   get:
 *     summary: Get project details for the public website (PUBLIC — no auth)
 *     description: >
 *       Returns marketing-safe project fields plus grouped media
 *       (photos, videos, creatives, unit_plans, payment_plans, developer_logo).
 *     tags: [Public Website]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Project details returned
 *       404:
 *         description: Project not found
 */
router.get("/projects/:id", ctrl.getPublicProjectById);

/**
 * @swagger
 * /api/v1/public/projects/{id}/inquiry:
 *   post:
 *     summary: Website lead API — submit the enquiry form on a project page (PUBLIC — no auth)
 *     description: >
 *       Creates a Lead directly, tied to this project. This is the
 *       "website lead" capture endpoint used by the project page's enquiry form.
 *     tags: [Public Website]
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
 *             required: [name, phone]
 *             properties:
 *               name:                 { type: string, example: "Priya Gupta" }
 *               phone:                { type: string, example: "9876543210" }
 *               email:                { type: string, example: "priya@example.com" }
 *               message:              { type: string, example: "Looking for a 3BHK, budget 1.2Cr" }
 *               budget:               { type: string }
 *               location_preference:  { type: string }
 *               configuration:        { type: string, example: "3BHK" }
 *     responses:
 *       201:
 *         description: Lead created
 *       400:
 *         description: name and phone are required
 *       404:
 *         description: Project not found
 */
router.post("/projects/:id/inquiry", ctrl.submitProjectInquiry);

module.exports = router;
