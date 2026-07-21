/**
 * bulkLeadsRoutes.js — Nextone Reality
 */

const express  = require('express');
const router   = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { uploadLeadsBulkFile } = require('../middleware/uploadMiddleware');
const {
  downloadLeadTemplate,
  bulkUploadLeads,
  downloadResultFile,
  bulkDeleteLeads,
} = require('../controllers/bulkLeadsController');

const ADMIN = ['super_admin', 'admin'];

/**
 * @swagger
 * tags:
 *   name: Bulk Leads
 *   description: Download the Excel template and bulk-upload leads from it
 */

/**
 * @swagger
 * /api/v1/leads/bulk/template:
 *   get:
 *     summary: Download Excel template for bulk lead upload
 *     description: >
 *       Returns an .xlsx file ready to fill in and re-upload.
 *
 *       **Column layout (fixed order — do not move columns):**
 *       | Col | Header | Type | Required |
 *       |-----|--------|------|----------|
 *       | A | Name | Free text | ✅ Yes |
 *       | B | Phone Number | Any format — international numbers OK | ✅ Yes |
 *       | C | Alternate Phone | Any format — international numbers OK | No |
 *       | D | Source | **Dropdown** (from lead_sources config) | No |
 *       | E | Budget | Free text (e.g. "60-80 Lakhs") | No |
 *       | F | Location Preference | Free text (e.g. "Andheri West") | No |
 *       | G | Project Name | **Dropdown, or type a free-text name** (active projects) | No |
 *       | H | Status | **Dropdown** (from lead_statuses config) | No — defaults to "new" |
 *       | I | Assign To | **Dropdown** (non-super_admin users) | No |
 *       | J | Configuration | **Dropdown** (unique configs across all projects, e.g. 1BHK / 2BHK) | No |
 *
 *       All dropdown lists are fetched **live from the database** each time the template is
 *       downloaded, so they always reflect the latest admin configuration. Project Name's
 *       dropdown is a soft (warning-style) validation — typing a name that isn't listed is
 *       still accepted and stored as free text on the lead (matches the regular lead APIs'
 *       project_name_text fallback) instead of being silently dropped.
 *
 *       **Required fields for a row to be accepted on upload:**
 *       Name, Phone Number only — everything else is optional. Phone / Alternate Phone have
 *       no format validation — international numbers are accepted as-is.
 *     tags: [Bulk Leads]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Excel file (.xlsx) with live dropdowns and 3 sample rows
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorised
 */
router.get('/template', authenticate, downloadLeadTemplate);

/**
 * @swagger
 * /api/v1/leads/bulk/upload:
 *   post:
 *     summary: Upload leads from the filled-in Excel template
 *     description: >
 *       Accepts a `.xlsx` file matching the downloaded template.
 *       Each row is validated and inserted as a lead.
 *
 *       **Required per row:** Name, Phone Number only
 *
 *       **Validation:**
 *       - Rows missing any required field are rejected with an error entry
 *       - Phone and Alternate Phone accept any format — no digit-count check,
 *         international numbers are fine
 *       - A phone number can be used on at most 3 leads total (e.g. interested in
 *         multiple projects); rows that would exceed this are skipped, not errored
 *       - Status defaults to "new" if blank or unrecognised
 *       - Project Name: matched against existing projects (case-insensitive);
 *         if it doesn't match anything, the typed text is kept on the lead as
 *         free text instead of being discarded
 *
 *       **Assignment priority:**
 *       1. `assign_to` UUID in the request body → all leads assigned to this user
 *       2. Assign To column (col I) → per-lead assignment matched by full name
 *       3. Neither → leads created unassigned
 *
 *       **Response:** JSON summary + a downloadable result `.xlsx` via `resultFile`
 *     tags: [Bulk Leads]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: The filled-in .xlsx template file
 *               assign_to:
 *                 type: string
 *                 format: uuid
 *                 description: >
 *                   (Optional) UUID of a user to assign ALL leads to.
 *                   Overrides the Assign To column for every row.
 *     responses:
 *       201:
 *         description: Upload processed — check the summary for per-row results
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Bulk upload completed"
 *               data:
 *                 total: 10
 *                 inserted: 8
 *                 skipped: 1
 *                 errors: 1
 *                 resultFile: "/uploads/leads/results/upload_result_1234567890.xlsx"
 *                 summary:
 *                   insertedLeads:
 *                     - id: "lead-uuid"
 *                       name: "Rahul Patel"
 *                       phone: "9876543210"
 *                       configuration: "2BHK"
 *                       assigned_to: "user-uuid"
 *                   errors:
 *                     - row: 5
 *                       error: "Missing required fields: Budget, Configuration"
 *                   skipped:
 *                     - row: 8
 *                       phone: "9000000001"
 *                       reason: "Phone number has already been used for 3 leads"
 *       400:
 *         description: No file uploaded, wrong template, or no valid rows found
 *       401:
 *         description: Unauthorised
 */
router.post('/upload', authenticate, uploadLeadsBulkFile, bulkUploadLeads);

/**
 * @swagger
 * /api/v1/leads/bulk/result/{filename}:
 *   get:
 *     summary: Download the result file from a previous bulk upload
 *     description: >
 *       Downloads the `.xlsx` result file produced after a bulk upload.
 *       The `filename` value comes from the `resultFile` field in the upload response.
 *       The file contains three sheets: Upload Summary, Errors (if any), Skipped (if any).
 *     tags: [Bulk Leads]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *           example: "upload_result_1234567890.xlsx"
 *     responses:
 *       200:
 *         description: Result Excel file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Result file not found
 */
router.get('/result/:filename', authenticate, downloadResultFile);

/**
 * @swagger
 * /api/v1/leads/bulk/delete:
 *   delete:
 *     summary: Bulk delete leads (Admin / Super Admin only)
 *     description: >
 *       Deletes multiple leads in a single call. Any ids that don't exist are
 *       reported back rather than causing the whole request to fail.
 *     tags: [Bulk Leads]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Deletion summary
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "2 lead(s) deleted"
 *               data:
 *                 deleted_count: 2
 *                 deleted_ids: ["uuid1", "uuid2"]
 *                 not_found_ids: []
 *       400:
 *         description: ids array missing or empty
 *       403:
 *         description: Only Admin / Super Admin can bulk-delete leads
 */
router.delete('/delete', authenticate, authorize(...ADMIN), bulkDeleteLeads);

module.exports = router;