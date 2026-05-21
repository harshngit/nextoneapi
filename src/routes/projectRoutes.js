const express = require("express");
const router = express.Router();
const projectController = require("../controllers/projectController");
const { authenticate, authorize }  = require("../middleware/auth");
const { uploadProjectDocuments }   = require("../middleware/uploadMiddleware");

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
 *     summary: Create a new project (JSON)
 *     description: >
 *       Adds a new real estate project to the system.
 *       Only Admin and Super Admin can create projects.
 *       This version takes a JSON body with optional unit_plans and creatives arrays
 *       containing file information from the upload API.
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
 *               name:            { type: string, example: "Skyline Heights" }
 *               developer:       { type: string, example: "Lodha Group" }
 *               city:            { type: string, example: "Mumbai" }
 *               locality:        { type: string }
 *               price_range:     { type: string, example: "80L - 1.5Cr" }
 *               total_units:     { type: integer }
 *               rera_number:     { type: string }
 *               status:          { type: string, enum: [active, upcoming, completed, inactive] }
 *               description:     { type: string }
 *               unit_plans:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     file_name: { type: string }
 *                     file_path: { type: string }
 *                     file_size: { type: integer }
 *                     mime_type: { type: string }
 *               creatives:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     file_name: { type: string }
 *                     file_path: { type: string }
 *                     file_size: { type: integer }
 *                     mime_type: { type: string }
 *     responses:
 *       201:
 *         description: Project created successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Project created successfully"
 *               data:
 *                 id: "proj-uuid"
 *                 name: "Skyline Heights"
 *                 status: "active"
 *       400:
 *         description: name and city are required
 */
router.post(
  "/",
  authenticate,
  authorize("super_admin", "admin"),
  projectController.createProject
);

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

/**
 * @swagger
 * /api/v1/projects/{id}/share:
 *   post:
 *     summary: Share project details via email with ZIP attachment
 *     description: >
 *       Sends a branded HTML email to one or more email addresses with:
 *         - Full project details (name, location, price, configs, RERA, possession, amenities)
 *         - All unit plans and creatives as a ZIP attachment (organised into Unit Plans / Creatives folders)
 *         - Optional personalised message from the sender
 *       The ZIP is built on-the-fly — no temp files stored.
 *     tags: [Projects]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Project UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [emails]
 *             properties:
 *               emails:
 *                 description: One email address (string) or multiple (array of strings)
 *                 oneOf:
 *                   - type: string
 *                     format: email
 *                     example: "client@example.com"
 *                   - type: array
 *                     items:
 *                       type: string
 *                       format: email
 *                     example: ["client@example.com", "partner@example.com"]
 *               message:
 *                 type: string
 *                 description: Optional personalised note shown at top of the email
 *                 example: "Hi Suresh, please find the Skyline Heights project details as discussed."
 *           example:
 *             emails: ["client@example.com", "partner@example.com"]
 *             message: "Hi, please find the project details as discussed."
 *     responses:
 *       200:
 *         description: Project shared — email sent successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Project shared successfully"
 *               data:
 *                 project_id: "proj-uuid-001"
 *                 project_name: "Skyline Heights"
 *                 sent_to: ["client@example.com", "partner@example.com"]
 *                 total_sent: 2
 *                 attached:
 *                   zip_name: "Skyline Heights_Documents.zip"
 *                   files: 5
 *                 shared_by: "Rahul Sharma"
 *       400:
 *         description: Missing emails, invalid email format
 *       404:
 *         description: Project not found
 */
const shareProjectController = require("../controllers/shareProjectController").shareProject;
router.post("/:id/share", authenticate, shareProjectController);

module.exports = router;