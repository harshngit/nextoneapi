/**
 * projectDocumentsRoutes.js — Nextone Reality
 * Routes for project document management
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { uploadProjectDocuments, uploadUnitPlan, uploadCreative, uploadPaymentPlan, uploadVideo, uploadPhoto, uploadDeveloperLogo } = require('../middleware/uploadMiddleware');
const {
  uploadProjectDocuments: uploadDocs,
  getProjectDocuments,
  downloadProjectDocument,
  downloadAllProjectDocuments,
  downloadAllUnitPlans,
  downloadAllCreatives,
  downloadAllPaymentPlans,
  downloadAllVideos,
  deleteProjectDocument,
  uploadStandaloneUnitPlan,
  uploadStandaloneCreative,
  uploadStandalonePaymentPlan,
  uploadStandaloneVideo,
  uploadStandalonePhoto,
  uploadStandaloneDeveloperLogo,
} = require('../controllers/projectDocumentsController');

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
 * /api/v1/projects/upload-payment-plan:
 *   post:
 *     summary: Upload a single payment plan
 *     description: Uploads a payment plan document without requiring a project ID. Returns file details. Accepts any field name for the file.
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
 *                 description: Payment plan document (accepts any field name)
 *     responses:
 *       201:
 *         description: Payment plan uploaded successfully
 */
router.post('/upload-payment-plan', authenticate, uploadPaymentPlan, uploadStandalonePaymentPlan);

/**
 * @swagger
 * /api/v1/projects/upload-video:
 *   post:
 *     summary: Upload a single video
 *     description: Uploads a video document without requiring a project ID. Returns file details. Accepts any field name for the file.
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
 *                 description: Video document (accepts any field name)
 *     responses:
 *       201:
 *         description: Video uploaded successfully
 */
router.post('/upload-video', authenticate, uploadVideo, uploadStandaloneVideo);

/**
 * @swagger
 * /api/v1/projects/upload-photo:
 *   post:
 *     summary: Upload a single project photo
 *     description: >
 *       Full URL: POST https://api.nextonerealty.in/api/v1/projects/upload-photo
 *
 *       Uploads a project photo without requiring a project ID. Returns file details
 *       (file_name, file_path, file_size, mime_type, url) — pass that into the photos
 *       array when creating/updating a project, or attach directly via
 *       POST /api/v1/projects/{id}/documents.
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
 *                 description: Photo file (accepts any field name)
 *     responses:
 *       201:
 *         description: Photo uploaded successfully
 */
router.post('/upload-photo', authenticate, uploadPhoto, uploadStandalonePhoto);

/**
 * @swagger
 * /api/v1/projects/upload-developer-logo:
 *   post:
 *     summary: Upload a developer logo
 *     description: >
 *       Full URL: POST https://api.nextonerealty.in/api/v1/projects/upload-developer-logo
 *
 *       Uploads a developer logo without requiring a project ID. Returns file details
 *       — pass that into the developer_logo field when creating/updating a project,
 *       or attach directly via POST /api/v1/projects/{id}/documents.
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
 *                 description: Logo image (accepts any field name)
 *     responses:
 *       201:
 *         description: Developer logo uploaded successfully
 */
router.post('/upload-developer-logo', authenticate, uploadDeveloperLogo, uploadStandaloneDeveloperLogo);

/**
 * @swagger
 * /api/v1/projects/{id}/documents:
 *   post:
 *     summary: Upload unit plans, creatives, photos, developer logo, and more for a project
 *     description: Uploads multiple files as unit plans, creatives, payment plans, videos, photos, or developer logo for a specific project.
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
 *               payment_plans:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Payment plan documents (multiple)
 *               videos:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Video documents (multiple)
 *               photos:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Project photos (multiple, up to 20)
 *               developer_logo:
 *                 type: string
 *                 format: binary
 *                 description: Developer logo (single file)
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
 * /api/v1/projects/{id}/documents/unit-plans/download-all:
 *   get:
 *     summary: Download all unit plans for a project as ZIP
 *     description: Compresses all unit plans for the project into a single ZIP file for download.
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
 *         description: ZIP file containing all unit plans
 *         content:
 *           application/zip:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/:id/documents/unit-plans/download-all', authenticate, downloadAllUnitPlans);

/**
 * @swagger
 * /api/v1/projects/{id}/documents/creatives/download-all:
 *   get:
 *     summary: Download all creatives for a project as ZIP
 *     description: Compresses all creatives for the project into a single ZIP file for download.
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
 *         description: ZIP file containing all creatives
 *         content:
 *           application/zip:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/:id/documents/creatives/download-all', authenticate, downloadAllCreatives);

/**
 * @swagger
 * /api/v1/projects/{id}/documents/payment-plans/download-all:
 *   get:
 *     summary: Download all payment plans for a project as ZIP
 *     description: Compresses all payment plans for the project into a single ZIP file for download.
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
 *         description: ZIP file containing all payment plans
 *         content:
 *           application/zip:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/:id/documents/payment-plans/download-all', authenticate, downloadAllPaymentPlans);

/**
 * @swagger
 * /api/v1/projects/{id}/documents/videos/download-all:
 *   get:
 *     summary: Download all videos for a project as ZIP
 *     description: Compresses all videos for the project into a single ZIP file for download.
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
 *         description: ZIP file containing all videos
 *         content:
 *           application/zip:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/:id/documents/videos/download-all', authenticate, downloadAllVideos);

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
