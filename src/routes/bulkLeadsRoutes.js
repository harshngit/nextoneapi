/**
 * bulkLeadsRoutes.js — Nextone Reality
 * Routes for bulk lead operations
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { uploadLeadsBulkFile } = require('../middleware/uploadMiddleware');
const {
  downloadLeadTemplate,
  bulkUploadLeads,
  downloadResultFile,
} = require('../controllers/bulkLeadsController');

/**
 * @swagger
 * tags:
 *   name: Bulk Leads
 *   description: Bulk lead operations like template download and bulk upload
 */

/**
 * @swagger
 * /api/v1/leads/bulk/template:
 *   get:
 *     summary: Download Excel template for bulk lead upload
 *     description: Returns an Excel file template with instructions and sample data for bulk lead upload.
 *     tags: [Bulk Leads]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Excel template file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/template', authenticate, downloadLeadTemplate);

/**
 * @swagger
 * /api/v1/leads/bulk/upload:
 *   post:
 *     summary: Upload bulk leads from Excel file
 *     description: >
 *       Processes an Excel file containing multiple leads. 
 *       Duplicates (by phone number) are skipped. 
 *       Returns a summary of successful imports, skipped records, and errors.
 *     tags: [Bulk Leads]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: The Excel file to upload
 *     responses:
 *       201:
 *         description: Upload processed successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Bulk upload completed"
 *               data:
 *                 summary:
 *                   total: 10
 *                   success: 8
 *                   skipped: 1
 *                   errors: 1
 *                 resultFile: "/api/v1/leads/bulk/result/upload_result_12345.xlsx"
 *       400:
 *         description: No file uploaded or invalid template
 */
router.post('/upload', authenticate, uploadLeadsBulkFile, bulkUploadLeads);

/**
 * @swagger
 * /api/v1/leads/bulk/result/{filename}:
 *   get:
 *     summary: Download result file after bulk upload
 *     description: Downloads the Excel result file which contains details about successful and failed imports from a specific upload.
 *     tags: [Bulk Leads]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: The name of the result file to download
 *     responses:
 *       200:
 *         description: Excel result file
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Result file not found
 */
router.get('/result/:filename', authenticate, downloadResultFile);

module.exports = router;
