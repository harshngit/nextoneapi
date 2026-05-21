const express = require("express");
const router = express.Router();
const uploadController = require("../controllers/uploadController");
const { authenticate } = require("../middleware/auth");
const { uploadSingleFile, uploadMultipleFiles } = require("../middleware/uploadMiddleware");

/**
 * @swagger
 * /api/v1/upload:
 *   post:
 *     summary: Upload a single file
 *     description: Uploads a file and returns a link. Use this for project unit plans or creatives before creating the project.
 *     tags: [Project Management]
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
 *     responses:
 *       200:
 *         description: File uploaded successfully
 */
router.post("/", authenticate, uploadSingleFile, uploadController.uploadFile);

/**
 * @swagger
 * /api/v1/upload/multiple:
 *   post:
 *     summary: Upload multiple files
 *     tags: [Project Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Files uploaded successfully
 */
router.post("/multiple", authenticate, uploadMultipleFiles, uploadController.uploadMultipleFiles);

module.exports = router;
