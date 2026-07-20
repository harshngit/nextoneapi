const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AppError = require('../utils/AppError');

// ── Storage engine for lead bulk uploads ──────────────────────────────────────
const leadBulkStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'leads', 'bulk');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const userId = req.user?.id || 'unknown';
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase();
    const fname = `bulk_leads_${userId}_${timestamp}${ext}`;
    cb(null, fname);
  },
});

// ── File filter for Excel files only ──────────────────────────────────────────
const excelFileFilter = (req, file, cb) => {
  const allowed = [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Only Excel files (.xls, .xlsx) are allowed', 400), false);
  }
};

const uploadLeadsBulk = multer({
  storage: leadBulkStorage,
  fileFilter: excelFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
});

// ── Storage engine for project documents ──────────────────────────────────────
const projectDocStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const projectId = req.params.id || req.body.project_id || 'temp';
    const docType = file.fieldname; // 'unit_plans' or 'creatives'
    const dir = path.join(process.cwd(), 'uploads', 'projects', projectId, docType);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fname = `${timestamp}_${sanitized}`;
    cb(null, fname);
  },
});

// ── File filter for project documents (PDF, images, docs, videos) ─────────────────────
const projectDocFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
  ];
  if (allowed.includes(file.mimetype) || file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(
      new AppError(
        'Only PDF, images (JPEG, PNG, WEBP), Word documents, and videos (MP4, WEBM, etc.) are allowed',
        400
      ),
      false
    );
  }
};

const uploadProjectDocs = multer({
  storage: projectDocStorage,
  fileFilter: projectDocFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max per file
});

// ── Storage engine for standalone (no project id yet) single-file uploads ─────
// Unlike projectDocStorage above, the destination folder here is FIXED per
// endpoint — it never depends on the client's chosen form field name, so the
// URL these standalone endpoints hand back always matches where the file
// actually landed on disk.
const standaloneStorageFor = (docType) => multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'projects', 'temp', docType);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${timestamp}_${sanitized}`);
  },
});

const uploadStandalone = (docType) => multer({
  storage: standaloneStorageFor(docType),
  fileFilter: projectDocFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
}).any();

// ── Storage engine for lead voice recordings ───────────────────────────────────
const leadVoiceStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'leads', 'voice');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const leadId    = req.params.id || 'unknown';
    const timestamp = Date.now();
    const ext       = path.extname(file.originalname).toLowerCase() || '.webm';
    cb(null, `voice_${leadId}_${timestamp}${ext}`);
  },
});

const voiceFileFilter = (req, file, cb) => {
  const allowed = [
    'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4',
    'audio/wav', 'audio/x-wav', 'audio/wave',
    'audio/mp3', 'audio/3gpp', 'audio/aac',
    'application/octet-stream', // some browsers send this for blobs
  ];
  if (allowed.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
    cb(null, true);
  } else {
    cb(new AppError('Only audio files are allowed for voice recordings', 400), false);
  }
};

const uploadLeadVoice = multer({
  storage:    leadVoiceStorage,
  fileFilter: voiceFileFilter,
  limits:     { fileSize: 25 * 1024 * 1024 }, // 25 MB max
}).single('voice_recording');

// ── Storage engine for payment proof uploads (booking receipts/screenshots) ──
const paymentProofStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'payment-proofs');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase();
    const sanitized = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `payment_proof_${sanitized}_${timestamp}${ext}`);
  },
});

const paymentProofFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Only PDF, JPEG, PNG, or WEBP files are allowed for payment proof', 400), false);
  }
};

const uploadPaymentProofFile = multer({
  storage: paymentProofStorage,
  fileFilter: paymentProofFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
}).single('payment_proof');

// ── Storage engine for lead photos (front-page form photo — separate from payment proof) ──
const leadPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'leads', 'photos');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const leadId    = req.params.id || 'unknown';
    const timestamp = Date.now();
    const ext       = path.extname(file.originalname).toLowerCase();
    cb(null, `photo_${leadId}_${timestamp}${ext}`);
  },
});

const leadPhotoFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Only JPEG, PNG, or WEBP images are allowed for lead photos', 400), false);
  }
};

const uploadLeadPhotoFile = multer({
  storage: leadPhotoStorage,
  fileFilter: leadPhotoFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
}).single('photo');

// ── Storage engine for closure documents (cost sheet, payment proof) ──────────
const closureDocStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'closures', 'documents');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase();
    const sanitized = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `closure_doc_${sanitized}_${timestamp}${ext}`);
  },
});

const closureDocFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Only PDF, JPEG, PNG, or WEBP files are allowed for closure documents', 400), false);
  }
};

const uploadClosureDocFile = multer({
  storage: closureDocStorage,
  fileFilter: closureDocFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
}).single('document');

// ── Generic storage for one-off uploads ──────────────────────────────────────
const genericStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'temp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${timestamp}_${sanitized}`);
  },
});

const uploadGeneric = multer({
  storage: genericStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
});

// ── Middleware factories ──────────────────────────────────────────────────────

/**
 * Single Excel file upload for bulk lead import
 * Field name: `file`
 */
const uploadLeadsBulkFile = uploadLeadsBulk.single('file');

/**
 * Multiple files upload for project documents
 * Fields: 'unit_plans' (up to 10 files), 'creatives' (up to 10 files),
 *         'payment_plans' (up to 10 files), 'videos' (up to 10 files),
 *         'photos' (up to 20 files), 'developer_logo' (1 file)
 */
const uploadProjectDocuments = uploadProjectDocs.fields([
  { name: 'unit_plans', maxCount: 10 },
  { name: 'creatives',  maxCount: 10 },
  { name: 'payment_plans', maxCount: 10 },
  { name: 'videos', maxCount: 10 },
  { name: 'photos', maxCount: 20 },
  { name: 'developer_logo', maxCount: 1 },
]);

/**
 * Single file upload for unit plan (accepts any field name — always lands
 * in uploads/projects/temp/unit_plans regardless of the field name used)
 */
const uploadUnitPlan = uploadStandalone('unit_plans');

/**
 * Single file upload for creative (accepts any field name)
 */
const uploadCreative = uploadStandalone('creatives');

/**
 * Single file upload for payment plan (accepts any field name)
 */
const uploadPaymentPlan = uploadStandalone('payment_plans');

/**
 * Single file upload for video (accepts any field name)
 */
const uploadVideo = uploadStandalone('videos');

/**
 * Single file upload for a project photo (accepts any field name)
 */
const uploadPhoto = uploadStandalone('photos');

/**
 * Single file upload for a developer logo (accepts any field name)
 */
const uploadDeveloperLogo = uploadStandalone('developer_logo');

const uploadSingleFile = uploadGeneric.single('file');
const uploadMultipleFiles = uploadGeneric.array('files', 10);

module.exports = {
  uploadLeadsBulkFile,
  uploadProjectDocuments,
  uploadUnitPlan,
  uploadCreative,
  uploadPaymentPlan,
  uploadVideo,
  uploadPhoto,
  uploadDeveloperLogo,
  uploadLeadVoice,
  uploadPaymentProofFile,
  uploadLeadPhotoFile,
  uploadClosureDocFile,
  uploadSingleFile,
  uploadMultipleFiles,
};
