const express = require("express");
const router = express.Router();
const projectController = require("../controllers/projectController");
const { authenticate, authorize } = require("../middleware/auth");

/**
 * @swagger
 * tags:
 *   name: Project Management
 *   description: >
 *     Manage real estate projects — add property details, configurations,
 *     location info, and map leads to projects. Admin manages projects;
 *     Sales team uses them for quick lookup during lead handling.
 */

/**
 * @swagger
 * /api/v1/projects:
 *   get:
 *     summary: List all projects
 *     description: >
 *       Returns all projects with optional filters.
 *       All authenticated users can view projects for lead mapping purposes.
 *       Supports filtering by status, city, and search by name.
 *     tags: [Project Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive, upcoming, completed]
 *         example: active
 *       - in: query
 *         name: city
 *         schema:
 *           type: string
 *         example: Mumbai
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by project name or developer
 *         example: Skyline
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: per_page
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Projects list returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: "proj-uuid-001"
 *                   name: "Skyline Heights"
 *                   developer: "Lodha Group"
 *                   city: "Mumbai"
 *                   locality: "Andheri West"
 *                   status: "active"
 *                   configurations: ["1BHK", "2BHK", "3BHK"]
 *                   price_range: "80L - 2Cr"
 *                   total_leads: 45
 *               pagination:
 *                 total: 12
 *                 page: 1
 *                 per_page: 20
 *                 total_pages: 1
 */
router.get("/", authenticate, projectController.getAllProjects);

/**
 * @swagger
 * /api/v1/projects:
 *   post:
 *     summary: Create a new project
 *     description: >
 *       Adds a new real estate project to the system.
 *       Only Admin and Super Admin can create projects.
 *       Projects are then available for the sales team to map leads against.
 *     tags: [Project Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, city]
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Skyline Heights"
 *               developer:
 *                 type: string
 *                 example: "Lodha Group"
 *               city:
 *                 type: string
 *                 example: "Mumbai"
 *               locality:
 *                 type: string
 *                 example: "Andheri West"
 *               address:
 *                 type: string
 *                 example: "Plot 14, Veera Desai Road, Andheri West"
 *               configurations:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["1BHK", "2BHK", "3BHK"]
 *               price_range:
 *                 type: string
 *                 example: "80L - 2Cr"
 *               total_units:
 *                 type: integer
 *                 example: 240
 *               possession_date:
 *                 type: string
 *                 format: date
 *                 example: "2027-12-01"
 *               rera_number:
 *                 type: string
 *                 example: "P51800045678"
 *               amenities:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["Swimming Pool", "Gym", "Clubhouse"]
 *               status:
 *                 type: string
 *                 enum: [active, inactive, upcoming, completed]
 *                 example: "active"
 *               brochure_url:
 *                 type: string
 *                 example: "https://cdn.nextonerealty.com/brochures/skyline.pdf"
 *               description:
 *                 type: string
 *                 example: "Premium residential project in the heart of Andheri West"
 *           example:
 *             name: "Skyline Heights"
 *             developer: "Lodha Group"
 *             city: "Mumbai"
 *             locality: "Andheri West"
 *             address: "Plot 14, Veera Desai Road, Andheri West"
 *             configurations: ["1BHK", "2BHK", "3BHK"]
 *             price_range: "80L - 2Cr"
 *             total_units: 240
 *             possession_date: "2027-12-01"
 *             rera_number: "P51800045678"
 *             amenities: ["Swimming Pool", "Gym", "Clubhouse"]
 *             status: "active"
 *             description: "Premium residential project in the heart of Andheri West"
 *     responses:
 *       201:
 *         description: Project created successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Project created successfully"
 *               data:
 *                 id: "proj-uuid-001"
 *                 name: "Skyline Heights"
 *                 status: "active"
 *       403:
 *         description: Insufficient permissions
 */
router.post("/", authenticate, authorize("super_admin", "admin"), projectController.createProject);

/**
 * @swagger
 * /api/v1/projects/{id}:
 *   get:
 *     summary: Get project details
 *     description: >
 *       Returns full details of a project including configurations,
 *       amenities, location, and total lead count mapped to this project.
 *     tags: [Project Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "proj-uuid-001"
 *     responses:
 *       200:
 *         description: Project details returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 id: "proj-uuid-001"
 *                 name: "Skyline Heights"
 *                 developer: "Lodha Group"
 *                 city: "Mumbai"
 *                 locality: "Andheri West"
 *                 address: "Plot 14, Veera Desai Road"
 *                 configurations: ["1BHK", "2BHK", "3BHK"]
 *                 price_range: "80L - 2Cr"
 *                 total_units: 240
 *                 possession_date: "2027-12-01"
 *                 rera_number: "P51800045678"
 *                 amenities: ["Swimming Pool", "Gym", "Clubhouse"]
 *                 status: "active"
 *                 total_leads: 45
 *                 created_at: "2025-01-10T09:00:00Z"
 *       404:
 *         description: Project not found
 */
router.get("/:id", authenticate, projectController.getProjectById);

/**
 * @swagger
 * /api/v1/projects/{id}:
 *   put:
 *     summary: Update project details
 *     description: >
 *       Updates any field of an existing project.
 *       Only Admin and Super Admin can update projects.
 *     tags: [Project Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "proj-uuid-001"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               developer:
 *                 type: string
 *               price_range:
 *                 type: string
 *               configurations:
 *                 type: array
 *                 items:
 *                   type: string
 *               amenities:
 *                 type: array
 *                 items:
 *                   type: string
 *               possession_date:
 *                 type: string
 *                 format: date
 *               brochure_url:
 *                 type: string
 *               description:
 *                 type: string
 *           example:
 *             price_range: "90L - 2.2Cr"
 *             configurations: ["2BHK", "3BHK", "4BHK"]
 *             amenities: ["Swimming Pool", "Gym", "Clubhouse", "Rooftop Garden"]
 *     responses:
 *       200:
 *         description: Project updated successfully
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Project not found
 */
router.put("/:id", authenticate, authorize("super_admin", "admin"), projectController.updateProject);

/**
 * @swagger
 * /api/v1/projects/{id}:
 *   delete:
 *     summary: Deactivate a project
 *     description: >
 *       Soft-deactivates a project by setting its status to 'inactive'.
 *       Existing leads mapped to this project are NOT affected.
 *       Only Admin and Super Admin can deactivate projects.
 *     tags: [Project Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "proj-uuid-001"
 *     responses:
 *       200:
 *         description: Project deactivated successfully
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Project not found
 */
router.delete("/:id", authenticate, authorize("super_admin", "admin"), projectController.deleteProject);

/**
 * @swagger
 * /api/v1/projects/{id}/status:
 *   patch:
 *     summary: Update project status
 *     description: >
 *       Updates the status of a project.
 *       Valid transitions: upcoming → active → completed / inactive
 *     tags: [Project Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "proj-uuid-001"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, inactive, upcoming, completed]
 *           example:
 *             status: "completed"
 *     responses:
 *       200:
 *         description: Project status updated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Project status updated to completed"
 *       400:
 *         description: Invalid status value
 */
router.patch("/:id/status", authenticate, authorize("super_admin", "admin"), projectController.updateProjectStatus);

/**
 * @swagger
 * /api/v1/projects/{id}/leads:
 *   get:
 *     summary: Get all leads mapped to a project
 *     description: >
 *       Returns all leads that are currently mapped to a specific project.
 *       Useful for project-wise pipeline view.
 *     tags: [Project Management]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: "proj-uuid-001"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter leads by status
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: per_page
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Leads for this project returned
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 project: { id: "proj-uuid-001", name: "Skyline Heights" }
 *                 leads:
 *                   - id: "lead-uuid-001"
 *                     name: "Suresh Patel"
 *                     status: "interested"
 *                     assigned_to: "Rahul Sharma"
 *               pagination:
 *                 total: 45
 *                 page: 1
 *                 per_page: 20
 *                 total_pages: 3
 */
router.get("/:id/leads", authenticate, authorize("super_admin", "admin", "sales_manager"), projectController.getProjectLeads);

module.exports = router;
