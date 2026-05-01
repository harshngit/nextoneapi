const multer = require('multer')
const path   = require('path')
const fs     = require('fs')
const AppError = require('../utils/AppError')

// ── Storage engine ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // subfolder determined by route: 'checkin' or 'checkout'
    const subfolder = req.uploadSubfolder || 'misc'
    const dir = path.join(process.cwd(), 'uploads', 'attendance', subfolder)
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    const userId  = req.user?.id || 'unknown'
    const today   = new Date().toISOString().split('T')[0]
    const ext     = path.extname(file.originalname).toLowerCase() || '.jpg'
    const fname   = `${userId}_${today}_${Date.now()}${ext}`
    cb(null, fname)
  },
})

// ── File filter — images only ─────────────────────────────────────────────────
const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
  if (allowed.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new AppError('Only JPEG, PNG and WEBP images are allowed', 400), false)
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
})

// ── Middleware factories ───────────────────────────────────────────────────────

/**
 * Single photo upload for check-in.
 * Field name: `photo`
 * Attaches req.uploadSubfolder = 'checkin' before multer runs.
 */
const uploadCheckinPhoto = [
  (req, res, next) => { req.uploadSubfolder = 'checkin'; next() },
  upload.single('photo'),
]

/**
 * Single photo upload for check-out.
 * Field name: `photo`
 */
const uploadCheckoutPhoto = [
  (req, res, next) => { req.uploadSubfolder = 'checkout'; next() },
  upload.single('photo'),
]

module.exports = { uploadCheckinPhoto, uploadCheckoutPhoto }
