const path     = require('path')
const fs       = require('fs')
const ExcelJS  = require('exceljs')
const { pool } = require('../config/db')
const { sendSuccess, sendError, paginate } = require('../utils/response')
const AppError = require('../utils/AppError')

// ─── Helpers ──────────────────────────────────────────────────────────────────

const resolveStatus = async (checkInTime) => {
  try {
    const cfg = await pool.query(`SELECT value FROM system_config WHERE key='office_checkin_late'`)
    const lateStr   = cfg.rows[0]?.value || '09:30'
    const [lh, lm]  = lateStr.split(':').map(Number)
    const checkIn   = new Date(checkInTime)
    const lateLimit = new Date(checkIn)
    lateLimit.setHours(lh, lm, 0, 0)
    return checkIn > lateLimit ? 'late' : 'present'
  } catch { return 'present' }
}

const calcWorkingHours = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return null
  return parseFloat(((new Date(checkOut) - new Date(checkIn)) / 3600000).toFixed(2))
}

const getUserMeta = async (userId) => {
  const r = await pool.query(
    `SELECT id, first_name, last_name, role, email, phone FROM users WHERE id=$1`, [userId]
  )
  if (!r.rows.length) return null
  const u = r.rows[0]
  return { id: u.id, full_name: `${u.first_name} ${u.last_name||''}`.trim(), role: u.role, email: u.email, phone: u.phone }
}

const buildPhotoUrl = (file) => {
  if (!file) return null
  const subfolder = file.destination.split('attendance/')[1]
  return `/uploads/attendance/${subfolder}/${file.filename}`
}

// ─── Excel style helpers ──────────────────────────────────────────────────────

const STATUS_FILL = {
  present:  { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD1FAE5' } },
  late:     { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFEF3C7' } },
  absent:   { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFEE2E2' } },
  on_leave: { type:'pattern', pattern:'solid', fgColor:{ argb:'FFE0E7FF' } },
  half_day: { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFCE7F3' } },
  weekend:  { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF3F4F6' } },
}
const STATUS_FONT = {
  present:'065F46', late:'92400E', absent:'991B1B',
  on_leave:'3730A3', half_day:'9F1239', weekend:'6B7280',
}

const styleHeader = (row, argb = 'FF1E40AF') => {
  row.eachCell(cell => {
    cell.fill      = { type:'pattern', pattern:'solid', fgColor:{ argb } }
    cell.font      = { bold:true, color:{ argb:'FFFFFFFF' }, size:11 }
    cell.alignment = { vertical:'middle', horizontal:'center', wrapText:true }
    cell.border    = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} }
  })
  row.height = 30
}

const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString('en-IN',{ hour:'2-digit', minute:'2-digit', hour12:true }) : '-'
const fmtDate = (d) => d  ? new Date(d).toLocaleDateString('en-IN',{ day:'2-digit', month:'short', year:'numeric' }) : '-'
const toDateStr = (d) => d instanceof Date ? d.toISOString().split('T')[0] : String(d).split('T')[0]

// ─── 1. UPLOAD PHOTO ─────────────────────────────────────────────────────────
const uploadPhoto = (req, res, next) => {
  try {
    if (!req.file) return next(new AppError('No photo uploaded', 400))
    return sendSuccess(res, 'Photo uploaded', { photo_url: buildPhotoUrl(req.file) }, 201)
  } catch (err) { next(err) }
}

// ─── 2. CHECK IN ─────────────────────────────────────────────────────────────
const checkIn = async (req, res, next) => {
  try {
    const userId = req.user.id
    const today  = new Date().toISOString().split('T')[0]

    const existing = await pool.query(
      `SELECT id, check_in_time FROM attendance WHERE user_id=$1 AND date=$2`, [userId, today]
    )
    if (existing.rows[0]?.check_in_time) {
      if (req.file) fs.unlink(req.file.path, ()=>{})
      return next(new AppError('Already checked in today', 400))
    }

    const { latitude, longitude, address, device, notes } = req.body
    const checkInTime = new Date()
    const status      = await resolveStatus(checkInTime)
    const photo       = buildPhotoUrl(req.file)
    const ip          = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    const userMeta    = await getUserMeta(userId)

    let record
    if (existing.rows.length) {
      const r = await pool.query(
        `UPDATE attendance SET check_in_time=$1, status=$2,
           checkin_photo=COALESCE($3,checkin_photo),
           checkin_latitude=$4, checkin_longitude=$5, checkin_address=$6,
           checkin_ip=$7, checkin_device=$8, notes=COALESCE($9,notes), updated_at=NOW()
         WHERE user_id=$10 AND date=$11 RETURNING *`,
        [checkInTime, status, photo, latitude||null, longitude||null, address||null, ip, device||null, notes||null, userId, today]
      )
      record = r.rows[0]
    } else {
      const r = await pool.query(
        `INSERT INTO attendance
           (user_id,date,check_in_time,status,checkin_photo,
            checkin_latitude,checkin_longitude,checkin_address,checkin_ip,checkin_device,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [userId, today, checkInTime, status, photo, latitude||null, longitude||null, address||null, ip, device||null, notes||null]
      )
      record = r.rows[0]
    }

    return sendSuccess(res, 'Checked in successfully', { attendance: record, user: userMeta }, 201)
  } catch (err) { next(err) }
}

// ─── 3. CHECK OUT ─────────────────────────────────────────────────────────────
const checkOut = async (req, res, next) => {
  try {
    const userId = req.user.id
    const today  = new Date().toISOString().split('T')[0]

    const existing = await pool.query(`SELECT * FROM attendance WHERE user_id=$1 AND date=$2`, [userId, today])
    if (!existing.rows[0]?.check_in_time) {
      if (req.file) fs.unlink(req.file.path, ()=>{})
      return next(new AppError('You have not checked in yet today', 400))
    }
    if (existing.rows[0].check_out_time) {
      if (req.file) fs.unlink(req.file.path, ()=>{})
      return next(new AppError('Already checked out today', 400))
    }

    const { latitude, longitude, address, device, notes } = req.body
    const checkOutTime = new Date()
    const workingHours = calcWorkingHours(existing.rows[0].check_in_time, checkOutTime)
    const photo        = buildPhotoUrl(req.file)
    const ip           = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null
    const userMeta     = await getUserMeta(userId)

    const r = await pool.query(
      `UPDATE attendance SET check_out_time=$1, working_hours=$2,
         checkout_photo=COALESCE($3,checkout_photo),
         checkout_latitude=$4, checkout_longitude=$5, checkout_address=$6,
         checkout_ip=$7, checkout_device=$8, notes=COALESCE($9,notes), updated_at=NOW()
       WHERE user_id=$10 AND date=$11 RETURNING *`,
      [checkOutTime, workingHours, photo, latitude||null, longitude||null, address||null, ip, device||null, notes||null, userId, today]
    )

    return sendSuccess(res, 'Checked out successfully', {
      attendance: r.rows[0], user: userMeta, working_hours: workingHours,
    })
  } catch (err) { next(err) }
}

// ─── 4. TODAY ────────────────────────────────────────────────────────────────
const getToday = async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0]
    const r = await pool.query(
      `SELECT a.*, CONCAT(u.first_name,' ',u.last_name) AS full_name, u.role
       FROM attendance a JOIN users u ON u.id=a.user_id
       WHERE a.user_id=$1 AND a.date=$2`, [req.user.id, today]
    )
    const rec = r.rows[0] || null
    return sendSuccess(res, "Today's attendance", {
      date: today,
      is_checked_in:  !!(rec?.check_in_time),
      is_checked_out: !!(rec?.check_out_time),
      status:         rec?.status || 'absent',
      check_in_time:  rec?.check_in_time  || null,
      check_out_time: rec?.check_out_time || null,
      working_hours:  rec?.working_hours  || null,
      checkin_photo:  rec?.checkin_photo  || null,
      checkout_photo: rec?.checkout_photo || null,
      checkin_location:  rec ? { latitude:rec.checkin_latitude,  longitude:rec.checkin_longitude,  address:rec.checkin_address  } : null,
      checkout_location: rec ? { latitude:rec.checkout_latitude, longitude:rec.checkout_longitude, address:rec.checkout_address } : null,
      full_record: rec,
    })
  } catch (err) { next(err) }
}

// ─── 5. MY HISTORY ───────────────────────────────────────────────────────────
const getMyAttendance = async (req, res, next) => {
  try {
    const { from, to, page=1, per_page=30 } = req.query
    const userId = req.user.id
    const offset = (parseInt(page)-1)*parseInt(per_page)
    const now    = new Date()
    const start  = from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const end    = to   || now.toISOString().split('T')[0]

    const [cnt, data, sum] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM attendance WHERE user_id=$1 AND date BETWEEN $2 AND $3`, [userId,start,end]),
      pool.query(`SELECT a.*, CONCAT(u.first_name,' ',u.last_name) AS full_name, u.role
         FROM attendance a JOIN users u ON u.id=a.user_id
         WHERE a.user_id=$1 AND a.date BETWEEN $2 AND $3
         ORDER BY a.date DESC LIMIT $4 OFFSET $5`, [userId,start,end,parseInt(per_page),offset]),
      pool.query(`SELECT
           COUNT(*) FILTER (WHERE status IN ('present','late')) AS present,
           COUNT(*) FILTER (WHERE status='absent') AS absent,
           COUNT(*) FILTER (WHERE status IN ('on_leave','half_day')) AS on_leave,
           COUNT(*) FILTER (WHERE status='late') AS late,
           COALESCE(SUM(working_hours),0) AS total_working_hours
         FROM attendance WHERE user_id=$1 AND date BETWEEN $2 AND $3`, [userId,start,end]),
    ])
    const s = sum.rows[0]
    return res.json({
      ...paginate(data.rows, parseInt(cnt.rows[0].count), parseInt(page), parseInt(per_page)),
      summary: { present:parseInt(s.present), absent:parseInt(s.absent), on_leave:parseInt(s.on_leave), late:parseInt(s.late), total_working_hours:parseFloat(s.total_working_hours) },
      period: { from:start, to:end },
    })
  } catch (err) { next(err) }
}

// ─── 6. BY DATE (all users for one day) ──────────────────────────────────────
const getByDate = async (req, res, next) => {
  try {
    const { date } = req.query
    if (!date) return next(new AppError('date query param required (YYYY-MM-DD)', 400))

    const [recs, noRec] = await Promise.all([
      pool.query(
        `SELECT a.*, CONCAT(u.first_name,' ',u.last_name) AS full_name, u.role, u.email, u.phone
         FROM attendance a JOIN users u ON u.id=a.user_id
         WHERE a.date=$1 ORDER BY u.first_name ASC`, [date]
      ),
      pool.query(
        `SELECT u.id, CONCAT(u.first_name,' ',u.last_name) AS full_name, u.role, u.email, u.phone
         FROM users u WHERE u.is_active=true
           AND u.id NOT IN (SELECT user_id FROM attendance WHERE date=$1)
         ORDER BY u.first_name ASC`, [date]
      ),
    ])

    const summary = {
      present:  recs.rows.filter(r=>['present','late'].includes(r.status)).length,
      late:     recs.rows.filter(r=>r.status==='late').length,
      absent:   recs.rows.filter(r=>r.status==='absent').length + noRec.rows.length,
      on_leave: recs.rows.filter(r=>['on_leave','half_day'].includes(r.status)).length,
      total:    recs.rows.length + noRec.rows.length,
    }

    return sendSuccess(res, `Attendance for ${date}`, {
      date, summary,
      records:   recs.rows,
      no_record: noRec.rows.map(u=>({ ...u, status:'absent', check_in_time:null, check_out_time:null })),
    })
  } catch (err) { next(err) }
}

// ─── 7. BY MONTH (user × day grid) ───────────────────────────────────────────
const getByMonth = async (req, res, next) => {
  try {
    const { month=new Date().getMonth()+1, year=new Date().getFullYear(), user_id, page=1, per_page=50 } = req.query
    const m      = parseInt(month)
    const y      = parseInt(year)
    const start  = `${y}-${String(m).padStart(2,'0')}-01`
    const end    = new Date(y,m,0).toISOString().split('T')[0]
    const offset = (parseInt(page)-1)*parseInt(per_page)

    const uParams    = user_id ? [parseInt(per_page), offset, user_id] : [parseInt(per_page), offset]
    const uFilter    = user_id ? 'AND id=$3' : ''
    const cntParams  = user_id ? [user_id] : []
    const cntFilter  = user_id ? 'AND id=$1' : ''

    const [users, cnt, attRows] = await Promise.all([
      pool.query(`SELECT id,first_name,last_name,role,email FROM users WHERE is_active=true ${uFilter} ORDER BY first_name ASC LIMIT $1 OFFSET $2`, uParams),
      pool.query(`SELECT COUNT(*) FROM users WHERE is_active=true ${cntFilter}`, cntParams),
      pool.query(`SELECT a.* FROM attendance a WHERE a.date BETWEEN $1 AND $2 ${user_id?'AND a.user_id=$3':''}`,
        user_id ? [start,end,user_id] : [start,end]),
    ])

    const lookup = {}
    attRows.rows.forEach(r => {
      const d = toDateStr(r.date)
      if (!lookup[r.user_id]) lookup[r.user_id] = {}
      lookup[r.user_id][d] = r
    })

    const allDays = []
    const cur = new Date(start)
    while (cur <= new Date(end)) { allDays.push(cur.toISOString().split('T')[0]); cur.setDate(cur.getDate()+1) }

    const data = users.rows.map(u => {
      const days = allDays.map(date => {
        const isWk = [0,6].includes(new Date(date).getDay())
        const rec  = lookup[u.id]?.[date]
        return {
          date,
          day:            new Date(date).toLocaleDateString('en-IN',{weekday:'short'}),
          is_weekend:     isWk,
          status:         rec?.status || (isWk ? 'weekend' : 'absent'),
          check_in_time:  rec?.check_in_time  || null,
          check_out_time: rec?.check_out_time || null,
          working_hours:  rec?.working_hours  || null,
          checkin_photo:  rec?.checkin_photo  || null,
          checkout_photo: rec?.checkout_photo || null,
          checkin_address:  rec?.checkin_address  || null,
          checkout_address: rec?.checkout_address || null,
          is_manual_entry:  rec?.is_manual_entry  || false,
          reason:           rec?.reason || null,
        }
      })
      const wd = days.filter(d=>!d.is_weekend)
      return {
        user: { id:u.id, full_name:`${u.first_name} ${u.last_name||''}`.trim(), role:u.role, email:u.email },
        days,
        summary: {
          present:             wd.filter(d=>['present','late'].includes(d.status)).length,
          absent:              wd.filter(d=>d.status==='absent').length,
          on_leave:            wd.filter(d=>['on_leave','half_day'].includes(d.status)).length,
          late:                wd.filter(d=>d.status==='late').length,
          total_working_hours: parseFloat(wd.reduce((s,d)=>s+(d.working_hours||0),0).toFixed(2)),
          working_days:        wd.length,
        },
      }
    })

    return res.json({
      ...paginate(data, parseInt(cnt.rows[0].count), parseInt(page), parseInt(per_page)),
      month:m, year:y, period:{from:start,to:end}, all_days:allDays,
    })
  } catch (err) { next(err) }
}

// ─── 8. CALENDAR (single user) ────────────────────────────────────────────────
const getCalendar = async (req, res, next) => {
  try {
    const { role, id:callerId } = req.user
    const { user_id, month=new Date().getMonth()+1, year=new Date().getFullYear() } = req.query
    const targetId = ['super_admin','admin','sales_manager'].includes(role) ? (user_id||callerId) : callerId
    const m=parseInt(month), y=parseInt(year)
    const start=`${y}-${String(m).padStart(2,'0')}-01`
    const end=new Date(y,m,0).toISOString().split('T')[0]

    const userMeta = await getUserMeta(targetId)
    if (!userMeta) return next(new AppError('User not found',404))

    const recs = await pool.query(`SELECT * FROM attendance WHERE user_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date ASC`, [targetId,start,end])
    const map  = {}
    recs.rows.forEach(r=>{ map[toDateStr(r.date)] = r })

    const days=[], cur=new Date(start), endDate=new Date(end)
    while (cur<=endDate) {
      const ds=cur.toISOString().split('T')[0], isWk=[0,6].includes(cur.getDay())
      days.push({ date:ds, day:cur.toLocaleDateString('en-IN',{weekday:'short'}), is_weekend:isWk, ...(map[ds]||{status:isWk?'weekend':'absent'}) })
      cur.setDate(cur.getDate()+1)
    }
    const wd=days.filter(d=>!d.is_weekend)
    return sendSuccess(res,'Calendar fetched',{
      user:userMeta, month:m, year:y, days,
      summary:{
        present:wd.filter(d=>['present','late'].includes(d.status)).length,
        absent:wd.filter(d=>d.status==='absent').length,
        on_leave:wd.filter(d=>['on_leave','half_day'].includes(d.status)).length,
        late:wd.filter(d=>d.status==='late').length,
        total_working_hours:parseFloat(wd.reduce((s,d)=>s+(parseFloat(d.working_hours)||0),0).toFixed(2)),
        working_days:wd.length,
      },
    })
  } catch (err) { next(err) }
}

// ─── 9. BY USER ──────────────────────────────────────────────────────────────
const getByUser = async (req, res, next) => {
  try {
    const {user_id}=req.params, {from,to,page=1,per_page=30}=req.query
    const offset=(parseInt(page)-1)*parseInt(per_page)
    const now=new Date(), start=from||new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0], end=to||now.toISOString().split('T')[0]
    const uChk=await pool.query(`SELECT id,first_name,last_name,role,email FROM users WHERE id=$1`,[user_id])
    if (!uChk.rows.length) return next(new AppError('User not found',404))
    const [cnt,data,sum]=await Promise.all([
      pool.query(`SELECT COUNT(*) FROM attendance WHERE user_id=$1 AND date BETWEEN $2 AND $3`,[user_id,start,end]),
      pool.query(`SELECT a.*,CONCAT(u.first_name,' ',u.last_name) AS full_name,u.role FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.user_id=$1 AND a.date BETWEEN $2 AND $3 ORDER BY a.date DESC LIMIT $4 OFFSET $5`,[user_id,start,end,parseInt(per_page),offset]),
      pool.query(`SELECT COUNT(*) FILTER (WHERE status IN('present','late')) AS present,COUNT(*) FILTER (WHERE status='absent') AS absent,COUNT(*) FILTER (WHERE status IN('on_leave','half_day')) AS on_leave,COUNT(*) FILTER (WHERE status='late') AS late,COALESCE(SUM(working_hours),0) AS total_working_hours FROM attendance WHERE user_id=$1 AND date BETWEEN $2 AND $3`,[user_id,start,end]),
    ])
    const u=uChk.rows[0], s=sum.rows[0]
    return res.json({
      ...paginate(data.rows,parseInt(cnt.rows[0].count),parseInt(page),parseInt(per_page)),
      user:{id:u.id,full_name:`${u.first_name} ${u.last_name||''}`.trim(),role:u.role,email:u.email},
      summary:{present:parseInt(s.present),absent:parseInt(s.absent),on_leave:parseInt(s.on_leave),late:parseInt(s.late),total_working_hours:parseFloat(s.total_working_hours)},
      period:{from:start,to:end},
    })
  } catch (err) { next(err) }
}

// ─── 10. ALL (admin) ─────────────────────────────────────────────────────────
const getAll = async (req, res, next) => {
  try {
    const {from,to,user_id,status,page=1,per_page=30}=req.query
    const offset=(parseInt(page)-1)*parseInt(per_page)
    const now=new Date(), start=from||new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0], end=to||now.toISOString().split('T')[0]
    const conds=['a.date BETWEEN $1 AND $2'], params=[start,end]; let idx=3
    if (user_id){conds.push(`a.user_id=$${idx++}`);params.push(user_id)}
    if (status) {conds.push(`a.status=$${idx++}`); params.push(status)}
    const where=`WHERE ${conds.join(' AND ')}`
    const [cnt,data,sum]=await Promise.all([
      pool.query(`SELECT COUNT(*) FROM attendance a ${where}`,params),
      pool.query(`SELECT a.*,CONCAT(u.first_name,' ',u.last_name) AS full_name,u.role,u.email,u.phone FROM attendance a JOIN users u ON u.id=a.user_id ${where} ORDER BY a.date DESC,u.first_name ASC LIMIT $${idx++} OFFSET $${idx++}`,[...params,parseInt(per_page),offset]),
      pool.query(`SELECT COUNT(*) FILTER (WHERE status IN('present','late')) AS present,COUNT(*) FILTER (WHERE status='absent') AS absent,COUNT(*) FILTER (WHERE status IN('on_leave','half_day')) AS on_leave,COUNT(*) FILTER (WHERE status='late') AS late FROM attendance a ${where}`,params),
    ])
    const s=sum.rows[0]
    return res.json({
      ...paginate(data.rows,parseInt(cnt.rows[0].count),parseInt(page),parseInt(per_page)),
      summary:{present:parseInt(s.present),absent:parseInt(s.absent),on_leave:parseInt(s.on_leave),late:parseInt(s.late)},
      period:{from:start,to:end},
    })
  } catch (err) { next(err) }
}

// ─── 11. SUMMARY ─────────────────────────────────────────────────────────────
const getSummary = async (req, res, next) => {
  try {
    const {from,to,user_id}=req.query
    const now=new Date(), start=from||new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0], end=to||now.toISOString().split('T')[0]
    const conds=['a.date BETWEEN $1 AND $2'], params=[start,end]; let idx=3
    if (user_id){conds.push(`u.id=$${idx++}`);params.push(user_id)}
    const r=await pool.query(
      `SELECT u.id,CONCAT(u.first_name,' ',u.last_name) AS full_name,u.role,u.email,
              COUNT(a.id) FILTER (WHERE a.status IN('present','late')) AS present,
              COUNT(a.id) FILTER (WHERE a.status='absent') AS absent,
              COUNT(a.id) FILTER (WHERE a.status IN('on_leave','half_day')) AS on_leave,
              COUNT(a.id) FILTER (WHERE a.status='late') AS late,
              COUNT(a.id) AS total_days,
              COALESCE(SUM(a.working_hours),0) AS total_working_hours,
              MAX(a.date) FILTER (WHERE a.check_in_time IS NOT NULL) AS last_present
       FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND ${conds.join(' AND ')}
       WHERE u.is_active=true GROUP BY u.id ORDER BY u.first_name ASC`, params
    )
    return sendSuccess(res,'Summary fetched',{
      period:{from:start,to:end},
      data:r.rows.map(x=>({...x,present:parseInt(x.present),absent:parseInt(x.absent),on_leave:parseInt(x.on_leave),late:parseInt(x.late),total_days:parseInt(x.total_days),total_working_hours:parseFloat(x.total_working_hours),attendance_percent:parseInt(x.total_days)>0?parseFloat(((parseInt(x.present)/parseInt(x.total_days))*100).toFixed(1)):0})),
    })
  } catch (err) { next(err) }
}

// ─── 12. LATE ARRIVALS ───────────────────────────────────────────────────────
const getLateArrivals = async (req, res, next) => {
  try {
    const {from,to,user_id}=req.query
    const now=new Date(), start=from||new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0], end=to||now.toISOString().split('T')[0]
    const conds=[`a.status='late'`,'a.date BETWEEN $1 AND $2'], params=[start,end]; let idx=3
    if (user_id){conds.push(`a.user_id=$${idx++}`);params.push(user_id)}
    const r=await pool.query(`SELECT a.id,a.date,a.check_in_time,a.check_out_time,a.working_hours,a.checkin_address,CONCAT(u.first_name,' ',u.last_name) AS full_name,u.role,u.email FROM attendance a JOIN users u ON u.id=a.user_id WHERE ${conds.join(' AND ')} ORDER BY a.date DESC`,params)
    return sendSuccess(res,'Late arrivals fetched',{period:{from:start,to:end},total:r.rows.length,data:r.rows})
  } catch (err) { next(err) }
}

// ─── 13. MARK LEAVE ──────────────────────────────────────────────────────────
const markLeave = async (req, res, next) => {
  try {
    const {user_id,date,leave_type='full_day',reason}=req.body
    if (!user_id||!date) return next(new AppError('user_id and date required',400))
    const valid=['full_day','half_day','sick','casual','unpaid']
    if (!valid.includes(leave_type)) return next(new AppError(`leave_type must be one of: ${valid.join(', ')}`,400))
    const userMeta=await getUserMeta(user_id)
    if (!userMeta) return next(new AppError('User not found',404))
    const status=leave_type==='half_day'?'half_day':'on_leave'
    const r=await pool.query(`INSERT INTO attendance (user_id,date,status,leave_type,reason,is_manual_entry,manual_by) VALUES ($1,$2,$3,$4,$5,true,$6) ON CONFLICT (user_id,date) DO UPDATE SET status=EXCLUDED.status,leave_type=EXCLUDED.leave_type,reason=EXCLUDED.reason,is_manual_entry=true,manual_by=EXCLUDED.manual_by,updated_at=NOW() RETURNING *`,[user_id,date,status,leave_type,reason||null,req.user.id])
    return sendSuccess(res,'Leave marked',{attendance:r.rows[0],user:userMeta},201)
  } catch (err) { next(err) }
}

// ─── 14. MANUAL ENTRY ────────────────────────────────────────────────────────
const manualEntry = async (req, res, next) => {
  try {
    const {user_id,date,status,check_in_time,check_out_time,reason}=req.body
    if (!user_id||!date||!status) return next(new AppError('user_id, date and status required',400))
    const valid=['present','absent','on_leave','half_day','late']
    if (!valid.includes(status)) return next(new AppError(`status must be one of: ${valid.join(', ')}`,400))
    const userMeta=await getUserMeta(user_id)
    if (!userMeta) return next(new AppError('User not found',404))
    const wh=calcWorkingHours(check_in_time,check_out_time)
    const r=await pool.query(`INSERT INTO attendance (user_id,date,status,check_in_time,check_out_time,working_hours,reason,is_manual_entry,manual_by) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8) ON CONFLICT (user_id,date) DO UPDATE SET status=EXCLUDED.status,check_in_time=EXCLUDED.check_in_time,check_out_time=EXCLUDED.check_out_time,working_hours=EXCLUDED.working_hours,reason=EXCLUDED.reason,is_manual_entry=true,manual_by=EXCLUDED.manual_by,updated_at=NOW() RETURNING *`,[user_id,date,status,check_in_time||null,check_out_time||null,wh,reason||null,req.user.id])
    return sendSuccess(res,'Manual entry saved',{attendance:r.rows[0],user:userMeta},201)
  } catch (err) { next(err) }
}

// ─── 15. UPDATE ──────────────────────────────────────────────────────────────
const updateAttendance = async (req, res, next) => {
  try {
    const {id}=req.params
    const ex=await pool.query(`SELECT * FROM attendance WHERE id=$1`,[id])
    if (!ex.rows.length) return next(new AppError('Record not found',404))
    const {check_in_time,check_out_time,status,reason,notes}=req.body
    const rec=ex.rows[0]
    const ni=check_in_time!==undefined?check_in_time:rec.check_in_time
    const no=check_out_time!==undefined?check_out_time:rec.check_out_time
    const r=await pool.query(`UPDATE attendance SET check_in_time=COALESCE($1,check_in_time),check_out_time=COALESCE($2,check_out_time),working_hours=$3,status=COALESCE($4,status),reason=COALESCE($5,reason),notes=COALESCE($6,notes),is_manual_entry=true,manual_by=$7,updated_at=NOW() WHERE id=$8 RETURNING *`,[check_in_time||null,check_out_time||null,calcWorkingHours(ni,no),status||null,reason||null,notes||null,req.user.id,id])
    return sendSuccess(res,'Updated',{attendance:r.rows[0],user:await getUserMeta(r.rows[0].user_id)})
  } catch (err) { next(err) }
}

// ─── 16. DELETE ──────────────────────────────────────────────────────────────
const deleteAttendance = async (req, res, next) => {
  try {
    const r=await pool.query(`DELETE FROM attendance WHERE id=$1 RETURNING *`,[req.params.id])
    if (!r.rows.length) return next(new AppError('Record not found',404))
    const rec=r.rows[0]
    ;[rec.checkin_photo,rec.checkout_photo].forEach(p=>{if(p){const f=path.join(process.cwd(),p);if(fs.existsSync(f))fs.unlinkSync(f)}})
    return sendSuccess(res,'Record deleted')
  } catch (err) { next(err) }
}

// ─── 17. EXPORT EXCEL ────────────────────────────────────────────────────────
const exportExcel = async (req, res, next) => {
  try {
    const { month=new Date().getMonth()+1, year=new Date().getFullYear(), from, to, user_id } = req.query
    const m=parseInt(month), y=parseInt(year)
    const start = from || `${y}-${String(m).padStart(2,'0')}-01`
    const end   = to   || new Date(y,m,0).toISOString().split('T')[0]

    const uF   = user_id ? 'AND a.user_id=$3' : ''
    const uP   = user_id ? [start,end,user_id] : [start,end]
    const usrF = user_id ? 'AND id=$1' : ''
    const usrP = user_id ? [user_id] : []

    const [allRecs, usersRes] = await Promise.all([
      pool.query(`SELECT a.*,CONCAT(u.first_name,' ',u.last_name) AS full_name,u.role,u.email,u.phone FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.date BETWEEN $1 AND $2 ${uF} ORDER BY a.date ASC,u.first_name ASC`, uP),
      pool.query(`SELECT id,first_name,last_name,role,email FROM users WHERE is_active=true ${usrF} ORDER BY first_name ASC`, usrP),
    ])

    const allDays=[]
    const cur=new Date(start)
    while(cur<=new Date(end)){allDays.push(cur.toISOString().split('T')[0]);cur.setDate(cur.getDate()+1)}

    const lookup={}
    allRecs.rows.forEach(r=>{const d=toDateStr(r.date);if(!lookup[r.user_id])lookup[r.user_id]={};lookup[r.user_id][d]=r})

    const wb = new ExcelJS.Workbook()
    wb.creator='NextOne Realty CRM'; wb.created=new Date()

    // ── TAB 1: All Records ─────────────────────────────────────────
    const ws1 = wb.addWorksheet('All Records',{views:[{state:'frozen',xSplit:0,ySplit:2}],properties:{tabColor:{argb:'FF1E40AF'}}})
    ws1.mergeCells('A1:L1')
    const t1=ws1.getCell('A1')
    t1.value=`Attendance Records  |  ${fmtDate(start)} – ${fmtDate(end)}`
    t1.font={bold:true,size:13,color:{argb:'FFFFFFFF'}}; t1.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E3A8A'}}
    t1.alignment={vertical:'middle',horizontal:'center'}; ws1.getRow(1).height=32

    ws1.columns=[
      {key:'sno',width:6},{key:'name',width:24},{key:'role',width:18},{key:'date',width:14},
      {key:'status',width:14},{key:'in',width:12},{key:'out',width:12},{key:'wh',width:12},
      {key:'loc',width:26},{key:'manual',width:10},{key:'reason',width:22},{key:'email',width:26},
    ]
    const h1=ws1.getRow(2)
    h1.values=['#','Name','Role','Date','Status','Check-In','Check-Out','Working Hrs','Location','Manual?','Reason','Email']
    styleHeader(h1)

    allRecs.rows.forEach((r,i)=>{
      const d=toDateStr(r.date)
      const row=ws1.addRow({sno:i+1,name:r.full_name,role:r.role?.replace(/_/g,' '),date:fmtDate(d),
        status:r.status?.toUpperCase(),in:fmtTime(r.check_in_time),out:fmtTime(r.check_out_time),
        wh:r.working_hours?`${r.working_hours}h`:'-',loc:r.checkin_address||'-',
        manual:r.is_manual_entry?'Yes':'No',reason:r.reason||'-',email:r.email})
      row.height=20
      const stCell=row.getCell('status')
      if(STATUS_FILL[r.status]) stCell.fill=STATUS_FILL[r.status]
      stCell.font={bold:true,size:10,color:{argb:`FF${STATUS_FONT[r.status]||'111827'}`}}
      stCell.alignment={horizontal:'center',vertical:'middle'}
      if(i%2===0) row.eachCell(cell=>{if(!cell.fill?.fgColor?.argb||cell.fill.fgColor.argb==='00000000') cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF9FAFB'}}})
    })
    ws1.autoFilter={from:'A2',to:'L2'}

    // ── TAB 2: By Month Grid ───────────────────────────────────────
    const ws2 = wb.addWorksheet('By Month',{views:[{state:'frozen',xSplit:3,ySplit:3}],properties:{tabColor:{argb:'FF059669'}}})
    const monthLabel = new Date(y,m-1).toLocaleString('en-IN',{month:'long'})
    ws2.mergeCells(1,1,1,3+allDays.length)
    const t2=ws2.getCell('A1')
    t2.value=`Monthly Grid  |  ${monthLabel} ${y}`
    t2.font={bold:true,size:13,color:{argb:'FFFFFFFF'}}; t2.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF065F46'}}
    t2.alignment={vertical:'middle',horizontal:'center'}; ws2.getRow(1).height=32

    // DOW row
    const dow=ws2.getRow(2)
    ;[1,2,3].forEach(c=>{dow.getCell(c).value=''})
    allDays.forEach((d,i)=>{
      const isWk=[0,6].includes(new Date(d).getDay())
      const cell=dow.getCell(4+i)
      cell.value=new Date(d).toLocaleDateString('en-IN',{weekday:'short'})
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:isWk?'FFE5E7EB':'FFD1FAE5'}}
      cell.font={bold:true,size:8,color:{argb:isWk?'FF6B7280':'FF065F46'}}
      cell.alignment={horizontal:'center',vertical:'middle'}
    })
    ws2.getRow(2).height=16

    // Date numbers row
    const dr=ws2.getRow(3)
    dr.getCell(1).value='#'; dr.getCell(2).value='Employee'; dr.getCell(3).value='Role'
    ;[1,2,3].forEach(c=>styleHeader(dr.getCell(c)))
    allDays.forEach((d,i)=>{
      const isWk=[0,6].includes(new Date(d).getDay())
      const cell=dr.getCell(4+i)
      cell.value=parseInt(d.split('-')[2])
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:isWk?'FFD1D5DB':'FF1E40AF'}}
      cell.font={bold:true,size:8,color:{argb:'FFFFFFFF'}}
      cell.alignment={horizontal:'center',vertical:'middle'}
      cell.border={top:{style:'thin'},bottom:{style:'thin'},left:{style:'hair'},right:{style:'hair'}}
    })
    ws2.getRow(3).height=22

    ws2.getColumn(1).width=5; ws2.getColumn(2).width=22; ws2.getColumn(3).width=15
    allDays.forEach((_,i)=>{ ws2.getColumn(4+i).width=4.5 })

    usersRes.rows.forEach((u,ui)=>{
      const row=ws2.getRow(4+ui)
      row.getCell(1).value=ui+1
      row.getCell(2).value=`${u.first_name} ${u.last_name||''}`.trim()
      row.getCell(3).value=u.role?.replace(/_/g,' ')
      ;[1,2,3].forEach(c=>{row.getCell(c).font={size:10};row.getCell(c).alignment={vertical:'middle'};row.getCell(c).border={top:{style:'hair'},bottom:{style:'hair'},left:{style:'thin'},right:{style:'thin'}}})
      allDays.forEach((d,i)=>{
        const isWk=[0,6].includes(new Date(d).getDay())
        const rec=lookup[u.id]?.[d]
        const st=rec?.status||(isWk?'weekend':'absent')
        const abbr={present:'P',late:'L',absent:'A',on_leave:'OL',half_day:'H',weekend:'-'}
        const cell=row.getCell(4+i)
        cell.value=abbr[st]||st.charAt(0).toUpperCase()
        cell.alignment={horizontal:'center',vertical:'middle'}
        cell.font={size:8,bold:true,color:{argb:`FF${STATUS_FONT[st]||'111827'}`}}
        if(STATUS_FILL[st]) cell.fill=STATUS_FILL[st]
        cell.border={top:{style:'hair'},bottom:{style:'hair'},left:{style:'hair'},right:{style:'hair'}}
      })
      row.height=18
    })

    // Legend
    const legRow=ws2.getRow(4+usersRes.rows.length+2)
    legRow.getCell(1).value='Legend:'; legRow.getCell(1).font={bold:true,size:10}
    const leg=[['P','Present','D1FAE5','065F46'],['L','Late','FEF3C7','92400E'],['A','Absent','FEE2E2','991B1B'],['OL','On Leave','E0E7FF','3730A3'],['H','Half Day','FCE7F3','9F1239'],['-','Weekend','F3F4F6','6B7280']]
    leg.forEach((l,i)=>{
      const c=legRow.getCell(2+i)
      c.value=`${l[0]}=${l[1]}`; c.fill={type:'pattern',pattern:'solid',fgColor:{argb:`FF${l[2]}`}}
      c.font={size:9,bold:true,color:{argb:`FF${l[3]}`}}; c.alignment={horizontal:'center',vertical:'middle'}
      c.border={top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}}
    })
    legRow.height=20

    // ── TAB 3: Summary ─────────────────────────────────────────────
    const ws3=wb.addWorksheet('Summary',{views:[{state:'frozen',xSplit:0,ySplit:2}],properties:{tabColor:{argb:'FF7C3AED'}}})
    ws3.mergeCells('A1:K1')
    const t3=ws3.getCell('A1')
    t3.value=`Summary  |  ${fmtDate(start)} – ${fmtDate(end)}`
    t3.font={bold:true,size:13,color:{argb:'FFFFFFFF'}}; t3.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF4C1D95'}}
    t3.alignment={vertical:'middle',horizontal:'center'}; ws3.getRow(1).height=32
    ws3.columns=[{key:'sno',width:6},{key:'name',width:24},{key:'role',width:18},{key:'present',width:10},{key:'late',width:8},{key:'absent',width:10},{key:'leave',width:10},{key:'wh',width:14},{key:'pct',width:14},{key:'last',width:16},{key:'email',width:26}]
    const h3=ws3.getRow(2)
    h3.values=['#','Employee','Role','Present','Late','Absent','On Leave','Working Hrs','Attend %','Last Seen','Email']
    styleHeader(h3,'FF4C1D95')

    const sr=await pool.query(`SELECT u.id,CONCAT(u.first_name,' ',u.last_name) AS full_name,u.role,u.email,COUNT(a.id) FILTER(WHERE a.status IN('present','late')) AS present,COUNT(a.id) FILTER(WHERE a.status='late') AS late,COUNT(a.id) FILTER(WHERE a.status='absent') AS absent,COUNT(a.id) FILTER(WHERE a.status IN('on_leave','half_day')) AS on_leave,COUNT(a.id) AS total_days,COALESCE(SUM(a.working_hours),0) AS total_wh,MAX(a.date) FILTER(WHERE a.check_in_time IS NOT NULL) AS last_present FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND a.date BETWEEN $1 AND $2 WHERE u.is_active=true ${user_id?'AND u.id=$3':''} GROUP BY u.id ORDER BY u.first_name ASC`, user_id?[start,end,user_id]:[start,end])

    sr.rows.forEach((r,i)=>{
      const pct=parseInt(r.total_days)>0?((parseInt(r.present)/parseInt(r.total_days))*100).toFixed(1):0
      const row=ws3.addRow({sno:i+1,name:r.full_name,role:r.role?.replace(/_/g,' '),present:parseInt(r.present),late:parseInt(r.late),absent:parseInt(r.absent),leave:parseInt(r.on_leave),wh:`${parseFloat(r.total_wh).toFixed(1)}h`,pct:`${pct}%`,last:r.last_present?fmtDate(r.last_present):'-',email:r.email})
      row.height=20; row.eachCell(c=>{c.alignment={vertical:'middle',horizontal:'center'}})
      row.getCell(2).alignment={vertical:'middle',horizontal:'left'}; row.getCell(3).alignment={vertical:'middle',horizontal:'left'}
      const pn=parseFloat(pct)
      const pc=row.getCell('pct')
      pc.fill={type:'pattern',pattern:'solid',fgColor:{argb:pn>=90?'FFD1FAE5':pn>=75?'FFFEF3C7':'FFFEE2E2'}}
      pc.font={bold:true,color:{argb:`FF${pn>=90?'065F46':pn>=75?'92400E':'991B1B'}`}}
      if(i%2===0) row.eachCell(c=>{if(!c.fill?.fgColor?.argb||c.fill.fgColor.argb==='00000000') c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF9FAFB'}}})
    })
    ws3.autoFilter={from:'A2',to:'K2'}

    // ── TAB 4: Late Arrivals ───────────────────────────────────────
    const ws4=wb.addWorksheet('Late Arrivals',{views:[{state:'frozen',xSplit:0,ySplit:2}],properties:{tabColor:{argb:'FFD97706'}}})
    ws4.mergeCells('A1:H1')
    const t4=ws4.getCell('A1')
    t4.value=`Late Arrivals  |  ${fmtDate(start)} – ${fmtDate(end)}`
    t4.font={bold:true,size:13,color:{argb:'FFFFFFFF'}}; t4.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF92400E'}}
    t4.alignment={vertical:'middle',horizontal:'center'}; ws4.getRow(1).height=32
    ws4.columns=[{key:'sno',width:6},{key:'name',width:24},{key:'role',width:18},{key:'date',width:14},{key:'in',width:12},{key:'out',width:12},{key:'wh',width:12},{key:'loc',width:30}]
    const h4=ws4.getRow(2); h4.values=['#','Employee','Role','Date','Check-In','Check-Out','Working Hrs','Location']; styleHeader(h4,'FF92400E')

    allRecs.rows.filter(r=>r.status==='late').forEach((r,i)=>{
      const d=toDateStr(r.date)
      const row=ws4.addRow({sno:i+1,name:r.full_name,role:r.role?.replace(/_/g,' '),date:fmtDate(d),in:fmtTime(r.check_in_time),out:fmtTime(r.check_out_time),wh:r.working_hours?`${r.working_hours}h`:'-',loc:r.checkin_address||'-'})
      row.height=20
      const ic=row.getCell('in'); ic.fill=STATUS_FILL.late; ic.font={bold:true,color:{argb:'FF92400E'}}; ic.alignment={horizontal:'center',vertical:'middle'}
      if(i%2===0) row.eachCell(c=>{if(!c.fill?.fgColor?.argb||c.fill.fgColor.argb==='00000000') c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFBEB'}}})
    })
    ws4.autoFilter={from:'A2',to:'H2'}

    // ── Stream ─────────────────────────────────────────────────────
    const filename=`Attendance_${monthLabel}_${y}.xlsx`
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`)
    res.setHeader('Cache-Control','no-cache')
    await wb.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

// ─── EOD CRON ─────────────────────────────────────────────────────────────────
const markAbsentEOD = async () => {
  try {
    const today=new Date().toISOString().split('T')[0]
    const r=await pool.query(`INSERT INTO attendance(user_id,date,status) SELECT u.id,$1,'absent' FROM users u WHERE u.is_active=true AND u.id NOT IN(SELECT user_id FROM attendance WHERE date=$1) ON CONFLICT(user_id,date) DO NOTHING RETURNING user_id`,[today])
    console.log(`[EOD Cron] ${r.rows.length} users marked absent for ${today}`)
    return r.rows.length
  } catch(err) { console.error('[markAbsentEOD]',err) }
}

module.exports = {
  uploadPhoto, checkIn, checkOut, getToday, getMyAttendance,
  getByDate, getByMonth, getByUser, getAll,
  getCalendar, getSummary, getLateArrivals,
  markLeave, manualEntry, updateAttendance, deleteAttendance,
  exportExcel, markAbsentEOD,
}