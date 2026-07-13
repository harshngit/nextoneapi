const express = require("express");
const router = express.Router();
const uploadController = require("../controllers/uploadController");
const { authenticate } = require("../middleware/auth");
const { uploadSingleFile, uploadMultipleFiles, uploadPaymentProofFile } = require("../middleware/uploadMiddleware");

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

/**
 * @swagger
 * /api/v1/upload/payment-proof:
 *   post:
 *     summary: Upload payment proof (receipt / screenshot / PDF) from the front-end form
 *     description: >
 *       Full URL: POST https://api.nextonerealty.in/api/v1/upload/payment-proof
 *
 *       Simple single-file upload for a booking/payment proof. Returns a url —
 *       save that url on the lead/booking record. Accepts PDF, JPEG, PNG, WEBP (max 10 MB).
 *       Field name must be payment_proof.
 *     tags: [Project Management]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [payment_proof]
 *             properties:
 *               payment_proof:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Payment proof uploaded successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Payment proof uploaded successfully"
 *               data:
 *                 url: "/uploads/payment-proofs/payment_proof_receipt_1234567890.jpg"
 *                 file_name: "receipt.jpg"
 *                 file_size: 204800
 *                 mime_type: "image/jpeg"
 *       400:
 *         description: No file uploaded or unsupported file type
 */
router.post("/payment-proof", authenticate, uploadPaymentProofFile, uploadController.uploadPaymentProof);

module.exports = router;
