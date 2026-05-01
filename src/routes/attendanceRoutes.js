const express = require('express')
const router  = express.Router()
const ctrl    = require('../controllers/attendanceController')
const { authenticate, authorize } = require('../middleware/auth')
const { uploadCheckinPhoto, uploadCheckoutPhoto } = require('../middleware/attendanceUpload')

const ADMIN   = ['super_admin', 'admin']
const MANAGER = ['super_admin', 'admin', 'sales_manager']

/**
 * @swagger
 * tags:
 *   name: Attendance
 *   description: >
 *     Mobile-first attendance with selfie upload and geo-location.
 *
 *     **Mobile check-in flow:**
 *     1. `POST /upload-photo?type=checkin`  → get back `photo_url`
 *     2. `POST /checkin`  with `photo_url` + GPS in body
 *     3. At end of day: repeat for checkout
 *
 *     **Status values:** `present` · `late` · `absent` · `on_leave` · `half_day`
 *
 *     **Excel export tabs:** All Records · By Month · Summary · Late Arrivals
 */

// ─────────────────────────────────────────────────────────────────────────────
// PHOTO UPLOAD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/attendance/upload-photo:
 *   post:
 *     summary: Upload a selfie photo (check-in or check-out)
 *     description: >
 *       Upload photo as **multipart/form-data** before calling checkin/checkout.
 *       Returns a `photo_url` — pass this in the checkin/checkout request body.
 *       Query param `type` = `checkin` or `checkout` controls the storage folder.
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [checkin, checkout]
 *         example: checkin
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [photo]
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *                 description: Selfie image (JPEG / PNG / WEBP, max 10 MB)
 *     responses:
 *       201:
 *         description: Photo uploaded
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: Photo uploaded
 *               data:
 *                 photo_url: "/uploads/attendance/checkin/uuid_2025-06-28_1719561124000.jpg"
 *       400:
 *         description: No photo / invalid file type
 */
router.post(
  '/upload-photo',
  authenticate,
  (req, res, next) => {
    // Route to correct multer instance based on ?type
    if (req.query.type === 'checkout') {
      return uploadCheckoutPhoto[0](req, res, () => uploadCheckoutPhoto[1](req, res, next))
    }
    return uploadCheckinPhoto[0](req, res, () => uploadCheckinPhoto[1](req, res, next))
  },
  ctrl.uploadPhoto
)

// ─────────────────────────────────────────────────────────────────────────────
// SELF / MOBILE ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/attendance/checkin:
 *   post:
 *     summary: Check in for the day
 *     description: >
 *       Server auto-records the check-in timestamp.
 *       Upload the selfie first via `/upload-photo?type=checkin`, then pass the
 *       returned `photo_url` here. All fields except auth are optional.
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               photo_url:
 *                 type: string
 *                 description: URL returned from /upload-photo
 *                 example: "/uploads/attendance/checkin/uuid_2025-06-28_xxx.jpg"
 *               latitude:
 *                 type: number
 *                 example: 19.0760
 *               longitude:
 *                 type: number
 *                 example: 72.8777
 *               address:
 *                 type: string
 *                 example: "Andheri West, Mumbai"
 *               device:
 *                 type: string
 *                 example: "iPhone 14 Pro / iOS 17"
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Checked in
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 attendance:
 *                   id: "uuid"
 *                   date: "2025-06-28"
 *                   check_in_time: "2025-06-28T09:14:00.000Z"
 *                   status: "late"
 *                   checkin_photo: "/uploads/attendance/checkin/uuid_xxx.jpg"
 *                   checkin_latitude: 19.076
 *                   checkin_longitude: 72.8777
 *                 user:
 *                   full_name: "Rahul Sharma"
 *                   role: "sales_executive"
 *       400:
 *         description: Already checked in
 */
router.post('/checkin', authenticate, ctrl.checkIn)

/**
 * @swagger
 * /api/v1/attendance/checkout:
 *   post:
 *     summary: Check out for the day
 *     description: >
 *       Server auto-records check-out time and calculates working hours.
 *       Must have checked in first. Pass `photo_url` from `/upload-photo?type=checkout`.
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               photo_url:
 *                 type: string
 *                 example: "/uploads/attendance/checkout/uuid_2025-06-28_xxx.jpg"
 *               latitude:   { type: number }
 *               longitude:  { type: number }
 *               address:    { type: string }
 *               device:     { type: string }
 *               notes:      { type: string }
 *     responses:
 *       200:
 *         description: Checked out
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 attendance:
 *                   check_in_time: "2025-06-28T09:14:00.000Z"
 *                   check_out_time: "2025-06-28T18:07:00.000Z"
 *                   working_hours: 8.88
 *                 user:
 *                   full_name: "Rahul Sharma"
 *                   role: "sales_executive"
 *                 working_hours: 8.88
 */
router.post('/checkout', authenticate, ctrl.checkOut)

/**
 * @swagger
 * /api/v1/attendance/today:
 *   get:
 *     summary: Today's attendance status (for mobile home screen)
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Today's record
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 date: "2025-06-28"
 *                 is_checked_in: true
 *                 is_checked_out: false
 *                 status: "present"
 *                 check_in_time: "2025-06-28T09:02:00.000Z"
 *                 check_out_time: null
 *                 working_hours: null
 */
router.get('/today', authenticate, ctrl.getToday)

/**
 * @swagger
 * /api/v1/attendance/me:
 *   get:
 *     summary: My own attendance history (paginated)
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from,     schema: { type: string, format: date } }
 *       - { in: query, name: to,       schema: { type: string, format: date } }
 *       - { in: query, name: page,     schema: { type: integer, default: 1 } }
 *       - { in: query, name: per_page, schema: { type: integer, default: 30 } }
 *     responses:
 *       200:
 *         description: Paginated list + summary
 */
router.get('/me', authenticate, ctrl.getMyAttendance)

/**
 * @swagger
 * /api/v1/attendance/calendar:
 *   get:
 *     summary: Monthly calendar for a single user (day-by-day)
 *     description: Admins/managers can pass any user_id. Others see only their own.
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: user_id, schema: { type: string, format: uuid } }
 *       - { in: query, name: month,   schema: { type: integer }, example: 6 }
 *       - { in: query, name: year,    schema: { type: integer }, example: 2025 }
 *     responses:
 *       200:
 *         description: Calendar with per-day status + summary
 */
router.get('/calendar', authenticate, ctrl.getCalendar)

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN / MANAGER — REPORTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/attendance/by-date:
 *   get:
 *     summary: All users' attendance for a specific date
 *     description: Returns records + a list of users with no record (absent by default).
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         required: true
 *         schema: { type: string, format: date }
 *         example: "2025-06-28"
 *     responses:
 *       200:
 *         description: Attendance for the day
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 date: "2025-06-28"
 *                 summary:
 *                   present: 18
 *                   late: 3
 *                   absent: 2
 *                   on_leave: 1
 *                   total: 24
 *                 records: []
 *                 no_record: []
 */
router.get(
  '/by-date',
  authenticate,
  authorize(...MANAGER),
  ctrl.getByDate
)

/**
 * @swagger
 * /api/v1/attendance/by-month:
 *   get:
 *     summary: All users × all days for a month (grid view)
 *     description: >
 *       Returns one entry per user containing a `days` array with a record
 *       for every calendar day of the month. Paginated by user.
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: month,    schema: { type: integer }, example: 6 }
 *       - { in: query, name: year,     schema: { type: integer }, example: 2025 }
 *       - { in: query, name: user_id,  schema: { type: string, format: uuid }, description: Filter to one user }
 *       - { in: query, name: page,     schema: { type: integer, default: 1 } }
 *       - { in: query, name: per_page, schema: { type: integer, default: 50 } }
 *     responses:
 *       200:
 *         description: Monthly grid
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               month: 6
 *               year: 2025
 *               all_days: ["2025-06-01", "2025-06-02"]
 *               data:
 *                 - user:
 *                     full_name: "Rahul Sharma"
 *                     role: "sales_executive"
 *                   summary:
 *                     present: 18
 *                     absent: 2
 *                     late: 3
 *                     on_leave: 1
 *                     working_days: 26
 *                     total_working_hours: 155.5
 *                   days:
 *                     - date: "2025-06-01"
 *                       day: "Sun"
 *                       is_weekend: true
 *                       status: "weekend"
 *                     - date: "2025-06-02"
 *                       day: "Mon"
 *                       is_weekend: false
 *                       status: "present"
 *                       check_in_time: "2025-06-02T09:01:00.000Z"
 *                       check_out_time: "2025-06-02T18:05:00.000Z"
 *                       working_hours: 9.07
 */
router.get(
  '/by-month',
  authenticate,
  authorize(...MANAGER),
  ctrl.getByMonth
)

/**
 * @swagger
 * /api/v1/attendance/summary:
 *   get:
 *     summary: Per-user attendance summary for a date range
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from,    schema: { type: string, format: date } }
 *       - { in: query, name: to,      schema: { type: string, format: date } }
 *       - { in: query, name: user_id, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: Summary per user
 */
router.get('/summary', authenticate, authorize(...MANAGER), ctrl.getSummary)

/**
 * @swagger
 * /api/v1/attendance/late:
 *   get:
 *     summary: Late arrivals report
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from,    schema: { type: string, format: date } }
 *       - { in: query, name: to,      schema: { type: string, format: date } }
 *       - { in: query, name: user_id, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: List of late records
 */
router.get('/late', authenticate, authorize(...MANAGER), ctrl.getLateArrivals)

/**
 * @swagger
 * /api/v1/attendance/export:
 *   get:
 *     summary: Export attendance to Excel (.xlsx)
 *     description: >
 *       Downloads an Excel file with **4 tabs:**
 *       1. **All Records** — every check-in/out row with colour-coded status
 *       2. **By Month** — user × day grid (P/L/A/OL/H) with colour cells
 *       3. **Summary** — present/absent/leave/hours per user with attendance %
 *       4. **Late Arrivals** — only late records
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: month,   schema: { type: integer }, example: 6 }
 *       - { in: query, name: year,    schema: { type: integer }, example: 2025 }
 *       - { in: query, name: from,    schema: { type: string, format: date }, description: Override start date }
 *       - { in: query, name: to,      schema: { type: string, format: date }, description: Override end date }
 *       - { in: query, name: user_id, schema: { type: string, format: uuid }, description: Export single user }
 *     responses:
 *       200:
 *         description: Excel file download
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/export', authenticate, authorize(...MANAGER), ctrl.exportExcel)

/**
 * @swagger
 * /api/v1/attendance/user/{user_id}:
 *   get:
 *     summary: Attendance history for a specific user
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: path, name: user_id, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: from,     schema: { type: string, format: date } }
 *       - { in: query, name: to,       schema: { type: string, format: date } }
 *       - { in: query, name: page,     schema: { type: integer, default: 1 } }
 *       - { in: query, name: per_page, schema: { type: integer, default: 30 } }
 *     responses:
 *       200:
 *         description: User's attendance + summary
 *       404:
 *         description: User not found
 */
router.get('/user/:user_id', authenticate, authorize(...MANAGER), ctrl.getByUser)

/**
 * @swagger
 * /api/v1/attendance:
 *   get:
 *     summary: All attendance records (admin, filterable + paginated)
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: from,     schema: { type: string, format: date } }
 *       - { in: query, name: to,       schema: { type: string, format: date } }
 *       - { in: query, name: user_id,  schema: { type: string, format: uuid } }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [present, absent, on_leave, half_day, late] }
 *       - { in: query, name: page,     schema: { type: integer, default: 1 } }
 *       - { in: query, name: per_page, schema: { type: integer, default: 30 } }
 *     responses:
 *       200:
 *         description: Paginated records + summary counts
 */
router.get('/', authenticate, authorize(...ADMIN), ctrl.getAll)

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — WRITE OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/attendance/leave:
 *   post:
 *     summary: Mark leave for a user (admin)
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, date]
 *             properties:
 *               user_id:    { type: string, format: uuid }
 *               date:       { type: string, format: date, example: "2025-06-30" }
 *               leave_type: { type: string, enum: [full_day, half_day, sick, casual, unpaid], default: full_day }
 *               reason:     { type: string }
 *     responses:
 *       201:
 *         description: Leave marked
 */
router.post('/leave',  authenticate, authorize(...ADMIN), ctrl.markLeave)

/**
 * @swagger
 * /api/v1/attendance/manual:
 *   post:
 *     summary: Manual attendance entry / override (admin)
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, date, status]
 *             properties:
 *               user_id:        { type: string, format: uuid }
 *               date:           { type: string, format: date }
 *               status:         { type: string, enum: [present, absent, on_leave, half_day, late] }
 *               check_in_time:  { type: string, format: date-time }
 *               check_out_time: { type: string, format: date-time }
 *               reason:         { type: string }
 *     responses:
 *       201:
 *         description: Manual record saved
 */
router.post('/manual', authenticate, authorize(...ADMIN), ctrl.manualEntry)

/**
 * @swagger
 * /api/v1/attendance/{id}:
 *   patch:
 *     summary: Edit an attendance record (admin)
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               check_in_time:  { type: string, format: date-time }
 *               check_out_time: { type: string, format: date-time }
 *               status:         { type: string, enum: [present, absent, on_leave, half_day, late] }
 *               reason:         { type: string }
 *               notes:          { type: string }
 *     responses:
 *       200:
 *         description: Record updated
 */
router.patch('/:id',   authenticate, authorize(...ADMIN), ctrl.updateAttendance)

/**
 * @swagger
 * /api/v1/attendance/{id}:
 *   delete:
 *     summary: Delete attendance record (super_admin only)
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: Deleted
 */
router.delete('/:id',  authenticate, authorize('super_admin'), ctrl.deleteAttendance)


/**
 * @swagger
 * /api/v1/attendance/pending:
 *   get:
 *     summary: Get pending approvals for a date (admin)
 *     description: >
 *       Returns records that need admin attention: not checked out,
 *       absent, or late. Defaults to today.
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *         description: Defaults to today
 *         example: "2025-06-28"
 *     responses:
 *       200:
 *         description: Pending records
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 date: "2025-06-28"
 *                 summary:
 *                   not_checked_out: 5
 *                   absent: 3
 *                   late: 4
 *                   total: 12
 *                 records: []
 */
router.get('/pending', authenticate, authorize(...ADMIN), ctrl.getPendingApprovals)

/**
 * @swagger
 * /api/v1/attendance/{id}/approve:
 *   patch:
 *     summary: Approve / change attendance status (admin/super_admin only)
 *     description: >
 *       Admin can review and change the status of any attendance record.
 *       Use cases: mark an absent as on_leave, change late to present, etc.
 *     tags: [Attendance]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Attendance record ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [present, absent, on_leave, half_day, late]
 *                 example: present
 *               reason:
 *                 type: string
 *                 example: "Employee was on field visit"
 *     responses:
 *       200:
 *         description: Status updated
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: Status updated to "present" successfully
 *               data:
 *                 attendance: {}
 *                 employee:
 *                   full_name: "Rahul Sharma"
 *                   role: "sales_executive"
 *                 change:
 *                   old_status: "absent"
 *                   new_status: "present"
 *                   reason: "Employee was on field visit"
 *                   approved_by: "Admin Name"
 *                   approved_at: "2025-06-28T10:00:00.000Z"
 *       400:
 *         description: Invalid status
 *       404:
 *         description: Record not found
 */
router.patch('/:id/approve', authenticate, authorize(...ADMIN), ctrl.approveStatus)

module.exports = router