const { sendSuccess } = require("../utils/response");
const AppError = require("../utils/AppError");

/**
 * POST /api/v1/upload
 * Generic upload for files. Returns file metadata and path/link.
 */
const uploadFile = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new AppError("No file uploaded", 400));
    }

    const fileData = {
      file_name: req.file.originalname,
      file_path: req.file.path.replace(/\\/g, '/'), // Ensure cross-platform compatibility
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      url: `/uploads/temp/${req.file.filename}`, // Direct link to the file
    };

    return sendSuccess(res, "File uploaded successfully", fileData);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/upload/multiple
 */
const uploadMultipleFiles = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return next(new AppError("No files uploaded", 400));
    }

    const filesData = req.files.map(file => ({
      file_name: file.originalname,
      file_path: file.path.replace(/\\/g, '/'),
      file_size: file.size,
      mime_type: file.mimetype,
      url: `/uploads/temp/${file.filename}`,
    }));

    return sendSuccess(res, "Files uploaded successfully", filesData);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/upload/payment-proof
 * Upload a payment proof file (receipt / screenshot / PDF) from the
 * front-end booking form. Returns file metadata and a url to save
 * alongside the booking/lead record.
 * Field name: payment_proof
 */
const uploadPaymentProof = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new AppError("No file uploaded. Use field name: payment_proof", 400));
    }

    return sendSuccess(res, "Payment proof uploaded successfully", {
      url:       `/uploads/payment-proofs/${req.file.filename}`,
      file_name: req.file.originalname,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
    }, 201);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  uploadFile,
  uploadMultipleFiles,
  uploadPaymentProof,
};
