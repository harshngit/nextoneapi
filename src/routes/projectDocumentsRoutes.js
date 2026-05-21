/**
 * projectDocumentsRoutes.js — Nextone Reality
 * Routes for project document management
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { uploadProjectDocuments } = require('../middleware/uploadMiddleware');
const {
  uploadProjectDocuments: uploadDocs,
  getProjectDocuments,
  downloadProjectDocument,
  downloadAllProjectDocuments,
  deleteProjectDocument,
  uploadStandaloneUnitPlan,
  uploadStandaloneCreative,
} = require('../controllers/projectDocumentsController');
const { uploadUnitPlan, uploadCreative } = require('../middleware/uploadMiddleware');

/**
 * @swagger
 * tags:
 *   name: Project Documents
 *   description: Management of unit plans and creatives for projects
 */

/**
 * @swagger
 * /api/v1/projects/upload-unit-plan:
 *   post:
 *     summary: Upload a single unit plan
 *     description: Uploads a unit plan document without requiring a project ID. Returns file details.
 *     tags: [Project Documents]
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
 *                 description: Unit plan document (accepts any field name)
 *     responses:
 *       201:
 *         description: Unit plan uploaded successfully
 */
router.post('/upload-unit-plan', authenticate, uploadUnitPlan, uploadStandaloneUnitPlan);

/**
 * @swagger
 * /api/v1/projects/upload-creative:
 *   post:
 *     summary: Upload a single creative
 *     description: Uploads a creative document without requiring a project ID. Returns file details. Accepts any field name for the file.
 *     tags: [Project Documents]
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
 *                 description: Creative document (accepts any field name)
 *     responses:
 *       201:
 *         description: Creative uploaded successfully
 */
router.post('/upload-creative', authenticate, uploadCreative, uploadStandaloneCreative);

/**
 * @swagger
 * /api/v1/projects/{id}/documents:
 *   post:
 *     summary: Upload unit plans and creatives for a project
 *     description: Uploads multiple files as unit plans or creatives for a specific project.
 *     tags: [Project Documents]
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               unit_plans:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Unit plan documents (multiple)
 *               creatives:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Creative documents (multiple)
 *     responses:
 *       200:
 *         description: Documents uploaded successfully
 *       400:
 *         description: No files uploaded
 *       404:
 *         description: Project not found
 */
router.post('/:id/documents', authenticate, uploadProjectDocuments, uploadDocs);

/**
 * @swagger
 * /api/v1/projects/{id}/documents:
 *   get:
 *     summary: Get all documents for a project
 *     description: Returns a list of all unit plans and creatives associated with a specific project.
 *     tags: [Project Documents]
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
 *     responses:
 *       200:
 *         description: List of documents
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 documents:
 *                   - id: "doc-uuid-1"
 *                     document_type: "unit_plan"
 *                     file_name: "plan_a.pdf"
 *                     url: "/api/v1/projects/proj-uuid/documents/doc-uuid-1/download"
 */
router.get('/:id/documents', authenticate, getProjectDocuments);

/**
 * @swagger
 * /api/v1/projects/{id}/documents/download-all:
 *   get:
 *     summary: Download all documents for a project as ZIP
 *     description: Compresses all documents for the project into a single ZIP file for download.
 *     tags: [Project Documents]
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
 *     responses:
 *       200:
 *         description: ZIP file containing all documents
 *         content:
 *           application/zip:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/:id/documents/download-all', authenticate, downloadAllProjectDocuments);

/**
 * @swagger
 * /api/v1/projects/{id}/documents/{docId}/download:
 *   get:
 *     summary: Download a specific document
 *     description: Downloads a single document by its ID.
 *     tags: [Project Documents]
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
 *       - in: path
 *         name: docId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Document UUID
 *     responses:
 *       200:
 *         description: The requested file
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Document not found
 */
router.get('/:id/documents/:docId/download', authenticate, downloadProjectDocument);

/**
 * @swagger
 * /api/v1/projects/{id}/documents/{docId}:
 *   delete:
 *     summary: Delete a specific document
 *     description: Deletes a document record and the corresponding file from storage.
 *     tags: [Project Documents]
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
 *       - in: path
 *         name: docId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Document UUID
 *     responses:
 *       200:
 *         description: Document deleted successfully
 *       404:
 *         description: Document not found
 */
router.delete('/:id/documents/:docId', authenticate, deleteProjectDocument);

module.exports = router;
