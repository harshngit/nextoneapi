const express = require("express");
const router = express.Router();
const projectController = require("../controllers/projectController");
const { authenticate, authorize }  = require("../middleware/auth");
const { checkPermission }          = require("../middleware/permissions");
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
 *           enum: [active, inactive, upcoming, completed, under_construction, pre_launch, nearby_possession, ready_to_move]
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
 *                   configurations:
 *                     - configuration: "1BHK"
 *                       carpet_area: "450 sqft"
 *                       price: "65L"
 *                     - configuration: "2BHK"
 *                       carpet_area: "650 sqft"
 *                       price: "85L"
 *                     - configuration: "3BHK"
 *                       carpet_area: "950 sqft"
 *                       price: "1.2Cr"
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
 *       Requires the "create" permission on Project Management (Access Control) —
 *       Super Admin always has it; other roles depend on their configured permissions.
 *       This version takes a JSON body with optional unit_plans, creatives, payment_plans, and videos arrays
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
 *               address:         { type: string }
 *               configurations:
 *                 type: array
 *                 description: >
 *                   Each unit configuration with its own carpet area and price
 *                   (not just a plain list of names).
 *                 items:
 *                   type: object
 *                   properties:
 *                     configuration: { type: string, example: "2BHK" }
 *                     carpet_area:   { type: string, example: "650 sqft" }
 *                     price:         { type: string, example: "85L" }
 *                 example:
 *                   - { configuration: "1BHK", carpet_area: "450 sqft", price: "65L" }
 *                   - { configuration: "2BHK", carpet_area: "650 sqft", price: "85L" }
 *                   - { configuration: "3BHK", carpet_area: "950 sqft", price: "1.2Cr" }
 *               price_range:     { type: string, example: "80L - 1.5Cr" }
 *               total_units:     { type: integer }
 *               possession_date: { type: string, format: date }
 *               rera_number:     { type: string }
 *               amenities:
 *                 type: array
 *                 items: { type: string }
 *                 example: ["Swimming Pool", "Gym", "Clubhouse"]
 *               status:
 *                 type: string
 *                 enum: [active, upcoming, completed, inactive, under_construction, pre_launch, nearby_possession, ready_to_move]
 *               description:     { type: string }
 *               brochure_url:    { type: string }
 *               video_url:       { type: string }
 *               payment_plan_url: { type: string }
 *               home_loan_info:  { type: string }
 *               photos:
 *                 type: array
 *                 description: >
 *                   Optional. Get file_name/file_path/file_size/mime_type from
 *                   POST /api/v1/projects/upload-photo first, then pass it here.
 *                 items:
 *                   type: object
 *                   properties:
 *                     file_name: { type: string, example: "exterior_1.jpg" }
 *                     file_path: { type: string, example: "/uploads/projects/exterior_1.jpg" }
 *                     file_size: { type: integer, example: 204800 }
 *                     mime_type: { type: string, example: "image/jpeg" }
 *               developer_logo:
 *                 type: object
 *                 description: >
 *                   Optional. Get file_name/file_path/file_size/mime_type from
 *                   POST /api/v1/projects/upload-developer-logo first, then pass it here.
 *                 properties:
 *                   file_name: { type: string, example: "lodha_logo.png" }
 *                   file_path: { type: string, example: "/uploads/projects/lodha_logo.png" }
 *                   file_size: { type: integer, example: 51200 }
 *                   mime_type: { type: string, example: "image/png" }
 *               unit_plans:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     file_name: { type: string, example: "floorplan_2bhk.pdf" }
 *                     file_path: { type: string, example: "/uploads/projects/floorplan_2bhk.pdf" }
 *                     file_size: { type: integer, example: 204800 }
 *                     mime_type: { type: string, example: "application/pdf" }
 *               creatives:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     file_name: { type: string, example: "floorplan_2bhk.pdf" }
 *                     file_path: { type: string, example: "/uploads/projects/floorplan_2bhk.pdf" }
 *                     file_size: { type: integer, example: 204800 }
 *                     mime_type: { type: string, example: "application/pdf" }
 *               payment_plans:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     file_name: { type: string, example: "floorplan_2bhk.pdf" }
 *                     file_path: { type: string, example: "/uploads/projects/floorplan_2bhk.pdf" }
 *                     file_size: { type: integer, example: 204800 }
 *                     mime_type: { type: string, example: "application/pdf" }
 *               videos:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     file_name: { type: string, example: "floorplan_2bhk.pdf" }
 *                     file_path: { type: string, example: "/uploads/projects/floorplan_2bhk.pdf" }
 *                     file_size: { type: integer, example: 204800 }
 *                     mime_type: { type: string, example: "application/pdf" }
 *           example:
 *             name: "Skyline Heights"
 *             developer: "Lodha Group"
 *             city: "Mumbai"
 *             locality: "Andheri West"
 *             address: "Plot 14, Veera Desai Road"
 *             configurations:
 *               - configuration: "1BHK"
 *                 carpet_area: "450 sqft"
 *                 price: "65L"
 *               - configuration: "2BHK"
 *                 carpet_area: "650 sqft"
 *                 price: "85L"
 *               - configuration: "3BHK"
 *                 carpet_area: "950 sqft"
 *                 price: "1.2Cr"
 *             price_range: "80L - 1.5Cr"
 *             total_units: 240
 *             possession_date: "2027-12-01"
 *             rera_number: "P51800045678"
 *             amenities:
 *               - "Swimming Pool"
 *               - "Gym"
 *               - "Clubhouse"
 *             status: "active"
 *             description: "Premium residential project in the heart of Andheri West"
 *             brochure_url: "/uploads/projects/brochure.pdf"
 *             video_url: "https://youtube.com/watch?v=abc"
 *             payment_plan_url: "/uploads/projects/payment_plan.pdf"
 *             home_loan_info: "Available through HDFC, SBI, ICICI"
 *             photos:
 *               - file_name: "exterior_1.jpg"
 *                 file_path: "/uploads/projects/exterior_1.jpg"
 *                 file_size: 204800
 *                 mime_type: "image/jpeg"
 *             developer_logo:
 *               file_name: "lodha_logo.png"
 *               file_path: "/uploads/projects/lodha_logo.png"
 *               file_size: 51200
 *               mime_type: "image/png"
 *             unit_plans:
 *               - file_name: "2bhk_floorplan.pdf"
 *                 file_path: "/uploads/projects/2bhk_floorplan.pdf"
 *                 file_size: 204800
 *                 mime_type: "application/pdf"
 *             creatives:
 *               - file_name: "project_banner.jpg"
 *                 file_path: "/uploads/projects/project_banner.jpg"
 *                 file_size: 512000
 *                 mime_type: "image/jpeg"
 *             payment_plans:
 *               - file_name: "payment_plan_clp.pdf"
 *                 file_path: "/uploads/projects/payment_plan_clp.pdf"
 *                 file_size: 102400
 *                 mime_type: "application/pdf"
 *             videos:
 *               - file_name: "project_walkthrough.mp4"
 *                 file_path: "/uploads/projects/project_walkthrough.mp4"
 *                 file_size: 10485760
 *                 mime_type: "video/mp4"
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
  checkPermission("projects", "create"),
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
 *                 configurations:
 *                   - configuration: "1BHK"
 *                     carpet_area: "450 sqft"
 *                     price: "65L"
 *                   - configuration: "2BHK"
 *                     carpet_area: "650 sqft"
 *                     price: "85L"
 *                   - configuration: "3BHK"
 *                     carpet_area: "950 sqft"
 *                     price: "1.2Cr"
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
 *       Requires the "edit" permission on Project Management (Access Control).
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
 *             description: Same fields as Create Project — all optional on update (send only what changed)
 *             properties:
 *               name:            { type: string, example: "Skyline Heights Phase 2" }
 *               developer:       { type: string, example: "Lodha Group" }
 *               city:            { type: string, example: "Mumbai" }
 *               locality:        { type: string }
 *               address:         { type: string }
 *               configurations:
 *                 type: array
 *                 description: Each unit configuration with its own carpet area and price
 *                 items:
 *                   type: object
 *                   properties:
 *                     configuration: { type: string, example: "2BHK" }
 *                     carpet_area:   { type: string, example: "650 sqft" }
 *                     price:         { type: string, example: "85L" }
 *                 example:
 *                   - { configuration: "1BHK", carpet_area: "450 sqft", price: "65L" }
 *                   - { configuration: "2BHK", carpet_area: "650 sqft", price: "85L" }
 *                   - { configuration: "3BHK", carpet_area: "950 sqft", price: "1.2Cr" }
 *               price_range:     { type: string, example: "90L - 2.2Cr" }
 *               total_units:     { type: integer }
 *               possession_date: { type: string, format: date }
 *               rera_number:     { type: string }
 *               amenities:
 *                 type: array
 *                 items: { type: string }
 *                 example: ["Swimming Pool", "Gym", "Clubhouse"]
 *               status:
 *                 type: string
 *                 enum: [active, upcoming, completed, inactive, under_construction, pre_launch, nearby_possession, ready_to_move]
 *               description:     { type: string }
 *               brochure_url:    { type: string }
 *               video_url:       { type: string }
 *               payment_plan_url: { type: string }
 *               home_loan_info:  { type: string }
 *               photos:
 *                 type: array
 *                 description: Get file details from POST /api/v1/projects/upload-photo first
 *                 items:
 *                   type: object
 *                   properties:
 *                     file_name: { type: string, example: "exterior_1.jpg" }
 *                     file_path: { type: string, example: "/uploads/projects/exterior_1.jpg" }
 *                     file_size: { type: integer, example: 204800 }
 *                     mime_type: { type: string, example: "image/jpeg" }
 *               developer_logo:
 *                 type: object
 *                 description: Get file details from POST /api/v1/projects/upload-developer-logo first
 *                 properties:
 *                   file_name: { type: string, example: "lodha_logo.png" }
 *                   file_path: { type: string, example: "/uploads/projects/lodha_logo.png" }
 *                   file_size: { type: integer, example: 51200 }
 *                   mime_type: { type: string, example: "image/png" }
 *               unit_plans:
 *                 type: array
 *                 description: New unit plan documents to add
 *                 items:
 *                   type: object
 *                   properties:
 *                     file_name: { type: string, example: "floorplan_2bhk.pdf" }
 *                     file_path: { type: string, example: "/uploads/projects/floorplan_2bhk.pdf" }
 *                     file_size: { type: integer, example: 204800 }
 *                     mime_type: { type: string, example: "application/pdf" }
 *               creatives:
 *                 type: array
 *                 description: New creative documents to add
 *                 items:
 *                   type: object
 *                   properties:
 *                     file_name: { type: string, example: "floorplan_2bhk.pdf" }
 *                     file_path: { type: string, example: "/uploads/projects/floorplan_2bhk.pdf" }
 *                     file_size: { type: integer, example: 204800 }
 *                     mime_type: { type: string, example: "application/pdf" }
 *               payment_plans:
 *                 type: array
 *                 description: New payment plan documents to add
 *                 items:
 *                   type: object
 *                   properties:
 *                     file_name: { type: string, example: "floorplan_2bhk.pdf" }
 *                     file_path: { type: string, example: "/uploads/projects/floorplan_2bhk.pdf" }
 *                     file_size: { type: integer, example: 204800 }
 *                     mime_type: { type: string, example: "application/pdf" }
 *               videos:
 *                 type: array
 *                 description: New video documents to add
 *                 items:
 *                   type: object
 *                   properties:
 *                     file_name: { type: string, example: "floorplan_2bhk.pdf" }
 *                     file_path: { type: string, example: "/uploads/projects/floorplan_2bhk.pdf" }
 *                     file_size: { type: integer, example: 204800 }
 *                     mime_type: { type: string, example: "application/pdf" }
 *           example:
 *             name: "Skyline Heights"
 *             developer: "Lodha Group"
 *             city: "Mumbai"
 *             locality: "Andheri West"
 *             address: "Plot 14, Veera Desai Road"
 *             configurations:
 *               - configuration: "1BHK"
 *                 carpet_area: "450 sqft"
 *                 price: "70L"
 *               - configuration: "2BHK"
 *                 carpet_area: "650 sqft"
 *                 price: "90L"
 *               - configuration: "3BHK"
 *                 carpet_area: "950 sqft"
 *                 price: "1.3Cr"
 *             price_range: "90L - 2.2Cr"
 *             total_units: 240
 *             possession_date: "2027-12-01"
 *             rera_number: "P51800045678"
 *             amenities:
 *               - "Swimming Pool"
 *               - "Gym"
 *               - "Clubhouse"
 *               - "Rooftop Garden"
 *             status: "active"
 *             description: "Premium residential project in the heart of Andheri West"
 *             brochure_url: "/uploads/projects/brochure.pdf"
 *             video_url: "https://youtube.com/watch?v=abc"
 *             payment_plan_url: "/uploads/projects/payment_plan.pdf"
 *             home_loan_info: "Available through HDFC, SBI, ICICI"
 *             developer_logo:
 *               file_name: "lodha_logo.png"
 *               file_path: "/uploads/projects/lodha_logo.png"
 *               file_size: 51200
 *               mime_type: "image/png"
 *             unit_plans:
 *               - file_name: "3bhk_floorplan.pdf"
 *                 file_path: "/uploads/projects/3bhk_floorplan.pdf"
 *                 file_size: 204800
 *                 mime_type: "application/pdf"
 *             creatives:
 *               - file_name: "project_banner.jpg"
 *                 file_path: "/uploads/projects/project_banner.jpg"
 *                 file_size: 512000
 *                 mime_type: "image/jpeg"
 *             payment_plans:
 *               - file_name: "payment_plan_clp.pdf"
 *                 file_path: "/uploads/projects/payment_plan_clp.pdf"
 *                 file_size: 102400
 *                 mime_type: "application/pdf"
 *             videos:
 *               - file_name: "project_walkthrough.mp4"
 *                 file_path: "/uploads/projects/project_walkthrough.mp4"
 *                 file_size: 10485760
 *                 mime_type: "video/mp4"
 *     responses:
 *       200:
 *         description: Project updated successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Project updated successfully"
 *               data:
 *                 project:
 *                   id: "proj-uuid-001"
 *                   name: "Skyline Heights"
 *                   status: "active"
 *                 documents:
 *                   - id: "doc-uuid-001"
 *                     document_type: "unit_plan"
 *                     file_name: "3bhk_floorplan.pdf"
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Project not found
 */
router.put("/:id", authenticate, checkPermission("projects", "edit"), projectController.updateProject);

/**
 * @swagger
 * /api/v1/projects/{id}:
 *   delete:
 *     summary: Deactivate a project
 *     description: >
 *       Soft-deactivates a project by setting its status to 'inactive'.
 *       Existing leads mapped to this project are NOT affected.
 *       Requires the "delete" permission on Project Management (Access Control).
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
router.delete("/:id", authenticate, checkPermission("projects", "delete"), projectController.deleteProject);

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
 *                 enum: [active, inactive, upcoming, completed, under_construction, pre_launch, nearby_possession, ready_to_move]
 *           example:
 *             status: "ready_to_move"
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
router.patch("/:id/status", authenticate, checkPermission("projects", "edit"), projectController.updateProjectStatus);

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
 *       Requires the "export" permission on Project Management (Access Control).
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
router.post("/:id/share", authenticate, checkPermission("projects", "export"), shareProjectController);

/**
 * @swagger
 * /api/v1/projects/{id}/share-whatsapp:
 *   post:
 *     summary: Share a project document via WhatsApp
 *     description: >
 *       Sends a specific project document (unit plan, creative, payment plan, or video)
 *       to a WhatsApp number as a document message.
 *       Requires BACKEND_URL env var to construct the public file link.
 *       Requires the "export" permission on Project Management (Access Control).
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
 *             required: [phone, document_id]
 *             properties:
 *               phone:
 *                 type: string
 *                 description: WhatsApp phone number (10-digit Indian or E.164 format)
 *                 example: "9876543210"
 *               document_id:
 *                 type: string
 *                 format: uuid
 *                 description: ID of the project document to send
 *                 example: "doc-uuid-001"
 *           example:
 *             phone: "9876543210"
 *             document_id: "doc-uuid-001"
 *     responses:
 *       200:
 *         description: Document sent via WhatsApp
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Document shared via WhatsApp"
 *               data:
 *                 project_id: "proj-uuid-001"
 *                 project_name: "Skyline Heights"
 *                 document:
 *                   id: "doc-uuid-001"
 *                   file_name: "2bhk_floorplan.pdf"
 *                   type: "unit_plan"
 *                 sent_to: "9876543210"
 *                 whatsapp_message_id: "wamid.xxx"
 *       400:
 *         description: Missing phone or document_id, invalid phone number
 *       404:
 *         description: Project or document not found
 *       500:
 *         description: BACKEND_URL not configured
 */
const shareProjectWhatsappController = require("../controllers/shareProjectController").shareProjectWhatsapp;
router.post("/:id/share-whatsapp", authenticate, checkPermission("projects", "export"), shareProjectWhatsappController);

module.exports = router;