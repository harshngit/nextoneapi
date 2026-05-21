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

// ── File filter for project documents (PDF, images, docs) ─────────────────────
const projectDocFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new AppError(
        'Only PDF, images (JPEG, PNG, WEBP), and Word documents are allowed',
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
 * Fields: 'unit_plans' (up to 10 files), 'creatives' (up to 10 files)
 */
const uploadProjectDocuments = uploadProjectDocs.fields([
  { name: 'unit_plans', maxCount: 10 },
  { name: 'creatives',  maxCount: 10 },
]);

/**
 * Single file upload for unit plan (accepts any field name)
 */
const uploadUnitPlan = uploadProjectDocs.any();

/**
 * Single file upload for creative (accepts any field name)
 */
const uploadCreative = uploadProjectDocs.any();

const uploadSingleFile = uploadGeneric.single('file');
const uploadMultipleFiles = uploadGeneric.array('files', 10);

module.exports = {
  uploadLeadsBulkFile,
  uploadProjectDocuments,
  uploadUnitPlan,
  uploadCreative,
  uploadLeadVoice,
  uploadSingleFile,
  uploadMultipleFiles,
};
