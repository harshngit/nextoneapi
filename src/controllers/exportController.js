/**
 * exportController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified Excel export for all modules.
 * Admin / Super Admin → all data
 * All other roles     → only their own assigned / created data
 *
 * GET /api/v1/export/leads
 * GET /api/v1/export/site-visits
 * GET /api/v1/export/follow-ups
 * GET /api/v1/export/projects
 * GET /api/v1/export/users          (admin only)
 * GET /api/v1/export/attendance     (admin = all, others = own)
 * GET /api/v1/export/all            (admin only – every module in one workbook)
 *
 * Common query params: from, to, project_id, status
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ExcelJS  = require('exceljs')
const { pool } = require('../config/db')
const AppError = require('../utils/AppError')

// ── Shared helpers ────────────────────────────────────────────────────────────

const ADMIN_ROLES = ['super_admin', 'admin']

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const fmtTime = (ts) =>
  ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'

const fmtDateTime = (ts) =>
  ts ? `${fmtDate(ts)} ${fmtTime(ts)}` : '—'

const toDateStr = (d) =>
  d instanceof Date ? d.toISOString().split('T')[0] : String(d).split('T')[0]

const isAdmin = (user) => ADMIN_ROLES.includes(user?.role)

/** Apply a coloured header row */
const styleHeader = (row, argb = 'FF1E3A8A') => {
  // eachCell only iterates already-committed cells — use getCell by index instead
  // If row is a Cell object (called with getCell result), style it directly
  if (typeof row.eachCell !== 'function') {
    // Called with a single Cell — style it directly
    const cell = row
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
    cell.font      = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false }
    cell.border    = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' },
    }
    return
  }
  row.height = 26
  const colCount = row.values ? row.values.length - 1 : (row.actualCellCount || 20)
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c)
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
    cell.font      = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false }
    cell.border    = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' },
    }
  }
}

/** Alternating row shading */
const shadeRow = (row, idx) => {
  if (idx % 2 !== 0) return
  // eachCell may skip empty cells — iterate by worksheet column count instead
  const ws = row.worksheet
  const colCount = ws ? ws.columnCount || ws.actualColumnCount || 20 : 20
  for (let c = 1; c <= colCount; c++) {
    try {
      const cell = row.getCell(c)
      const argb = cell.fill?.fgColor?.argb
      if (!argb || argb === '00000000' || argb === 'FF000000') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
      }
    } catch (_) { /* skip */ }
  }
}

/** Add a title banner cell (merged across all columns) */
const addTitle = (ws, text, cols, argb = 'FF1E3A8A') => {
  ws.mergeCells(1, 1, 1, cols)
  const cell = ws.getCell('A1')
  cell.value = text
  cell.font  = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }
  cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
  cell.alignment = { vertical: 'middle', horizontal: 'center' }
  ws.getRow(1).height = 34
}

/** Date-range default helpers */
const defaultRange = (from, to) => {
  const now  = new Date()
  const f    = from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const t    = to   || now.toISOString().split('T')[0]
  return { start: f, end: t }
}

/** Stream workbook to response */
const streamWorkbook = async (res, wb, filename) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Cache-Control', 'no-cache')
  await wb.xlsx.write(res)
  res.end()
}

// ─────────────────────────────────────────────────────────────────────────────
// ── LEADS EXPORT ──────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

const LEAD_STATUS_COLOR = {
  new:                   { fill: 'FFE0F2FE', font: '0C4A6E' },
  contacted:             { fill: 'FFDBEAFE', font: '1E40AF' },
  interested:            { fill: 'FFCFFAFE', font: '164E63' },
  follow_up:             { fill: 'FFFEF3C7', font: '92400E' },
  site_visit_scheduled:  { fill: 'FFEDE9FE', font: '4C1D95' },
  site_visit_done:       { fill: 'FFD1FAE5', font: '065F46' },
  negotiation:           { fill: 'FFFCE7F3', font: '9D174D' },
  booked:                { fill: 'FFD1FAE5', font: '065F46' },
  lost:                  { fill: 'FFFEE2E2', font: '991B1B' },
}

const buildLeadsSheet = async (wb, user, start, end, projectId) => {
  const admin = isAdmin(user)
  const conditions = [`l.is_archived = false`, `l.created_at::date BETWEEN $1 AND $2`]
  const params  = [start, end]
  let   idx     = 3
  if (!admin) { conditions.push(`l.assigned_to = $${idx++}`); params.push(user.id) }
  if (projectId) { conditions.push(`l.project_id = $${idx++}`); params.push(projectId) }

  const rows = await pool.query(
    `SELECT l.id, l.name, l.phone, l.alternate_phone_number, l.email,
            l.status, l.source, l.budget, l.location_preference,
            l.created_at, l.updated_at,
            CONCAT(u.first_name,' ',u.last_name) AS assigned_to_name,
            CONCAT(c.first_name,' ',c.last_name) AS created_by_name,
            p.name AS project_name, p.city AS project_city
     FROM leads l
     LEFT JOIN users    u ON u.id = l.assigned_to
     LEFT JOIN users    c ON c.id = l.created_by
     LEFT JOIN projects p ON p.id = l.project_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY l.created_at DESC`,
    params
  )

  const ws = wb.addWorksheet('Leads', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
    properties: { tabColor: { argb: 'FF3B82F6' } },
  })
  addTitle(ws, `Leads Export  |  ${fmtDate(start)} – ${fmtDate(end)}${admin ? '' : `  |  ${user.first_name} ${user.last_name}`}`, 15, 'FF1D4ED8')

  ws.columns = [
    { key: 'sno',      width: 5  },
    { key: 'name',     width: 22 }, { key: 'phone',    width: 16 },
    { key: 'alt',      width: 16 }, { key: 'email',    width: 26 },
    { key: 'status',   width: 20 }, { key: 'source',   width: 16 },
    { key: 'budget',   width: 14 }, { key: 'location', width: 20 },
    { key: 'project',  width: 22 }, { key: 'city',     width: 14 },
    { key: 'assigned', width: 20 }, { key: 'created_by',width:18 },
    { key: 'created',  width: 18 }, { key: 'updated',  width: 18 },
  ]
  const h = ws.getRow(2)
  h.values = ['#','Name','Phone','Alt Phone','Email','Status','Source','Budget',
    'Location Pref','Project','City','Assigned To','Created By','Created At','Updated At']
  styleHeader(h, 'FF1D4ED8')

  rows.rows.forEach((r, i) => {
    const sc   = LEAD_STATUS_COLOR[r.status] || { fill: 'FFF9FAFB', font: '111827' }
    const row  = ws.addRow({
      sno: i + 1, name: r.name, phone: r.phone, alt: r.alternate_phone_number || '—',
      email: r.email || '—', status: (r.status || '').replace(/_/g, ' ').toUpperCase(),
      source: r.source || '—', budget: r.budget || '—', location: r.location_preference || '—',
      project: r.project_name || '—', city: r.project_city || '—',
      assigned: r.assigned_to_name || '—', created_by: r.created_by_name || '—',
      created: fmtDateTime(r.created_at), updated: fmtDateTime(r.updated_at),
    })
    row.height = 20
    const sc2 = row.getCell('status')
    sc2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sc.fill } }
    sc2.font = { bold: true, size: 9, color: { argb: `FF${sc.font}` } }
    sc2.alignment = { horizontal: 'center', vertical: 'middle' }
    shadeRow(row, i)
  })

  // Summary sheet for leads
  const ws2 = wb.addWorksheet('Leads Summary', {
    properties: { tabColor: { argb: 'FF60A5FA' } },
  })
  addTitle(ws2, `Leads Summary  |  ${fmtDate(start)} – ${fmtDate(end)}`, 3, 'FF1D4ED8')
  ws2.columns = [{ key: 'status', width: 26 }, { key: 'count', width: 12 }, { key: 'pct', width: 12 }]
  const hs2 = ws2.getRow(2)
  hs2.values = ['Status', 'Count', '% Share']; styleHeader(hs2, 'FF1D4ED8')

  const total = rows.rows.length
  const countByStatus = {}
  rows.rows.forEach(r => { countByStatus[r.status] = (countByStatus[r.status] || 0) + 1 })
  Object.entries(countByStatus).sort((a, b) => b[1] - a[1]).forEach(([st, cnt], i) => {
    const sc = LEAD_STATUS_COLOR[st] || { fill: 'FFF9FAFB', font: '111827' }
    const row = ws2.addRow({
      status: st.replace(/_/g, ' ').toUpperCase(),
      count: cnt,
      pct: total > 0 ? `${((cnt / total) * 100).toFixed(1)}%` : '0%',
    })
    row.height = 22
    row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sc.fill } }
    row.getCell('status').font = { bold: true, color: { argb: `FF${sc.font}` } }
    row.getCell('count').alignment  = { horizontal: 'center' }
    row.getCell('pct').alignment    = { horizontal: 'center' }
  })
  const totRow = ws2.addRow({ status: 'TOTAL', count: total, pct: '100%' })
  totRow.height = 24
  for (let c = 1; c <= 3; c++) {
    const cell = totRow.getCell(c)
    cell.font      = { bold: true, size: 11 }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  }

  ws2.autoFilter = { from: 'A2', to: 'C2' }
  ws.autoFilter  = { from: 'A2', to: 'P2' }
  return rows.rows.length
}

// ─────────────────────────────────────────────────────────────────────────────
// ── SITE VISITS EXPORT ───────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

const SV_STATUS_COLOR = {
  scheduled:   { fill: 'FFE0F2FE', font: '0C4A6E' },
  done:        { fill: 'FFD1FAE5', font: '065F46' },
  cancelled:   { fill: 'FFFEE2E2', font: '991B1B' },
  rescheduled: { fill: 'FFFEF3C7', font: '92400E' },
  no_show:     { fill: 'FFF3F4F6', font: '374151' },
}

const buildSiteVisitsSheet = async (wb, user, start, end, projectId) => {
  const admin = isAdmin(user)
  const conditions = [`sv.visit_date BETWEEN $1 AND $2`]
  const params = [start, end]
  let idx = 3
  if (!admin) { conditions.push(`sv.assigned_to = $${idx++}`); params.push(user.id) }
  if (projectId) { conditions.push(`sv.project_id = $${idx++}`); params.push(projectId) }

  const rows = await pool.query(
    `SELECT sv.id, sv.visit_date, sv.visit_time, sv.status,
            sv.transport_arranged, sv.notes,
            sv.created_at,
            l.name  AS lead_name,  l.phone AS lead_phone, l.email AS lead_email,
            p.name  AS project_name, p.city AS project_city, p.locality,
            CONCAT(u.first_name,' ',u.last_name) AS assigned_to_name,
            svf.client_reaction, svf.next_step, svf.remarks, svf.rating
     FROM site_visits sv
     JOIN    leads    l   ON l.id  = sv.lead_id
     JOIN    projects p   ON p.id  = sv.project_id
     LEFT JOIN users  u   ON u.id  = sv.assigned_to
     LEFT JOIN site_visit_feedback svf ON svf.site_visit_id = sv.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sv.visit_date DESC, sv.visit_time DESC`,
    params
  )

  const ws = wb.addWorksheet('Site Visits', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
    properties: { tabColor: { argb: 'FF8B5CF6' } },
  })
  addTitle(ws, `Site Visits  |  ${fmtDate(start)} – ${fmtDate(end)}`, 15, 'FF6D28D9')
  ws.columns = [
    { key: 'sno',       width: 5  }, { key: 'lead',      width: 22 },
    { key: 'phone',     width: 15 }, { key: 'email',     width: 24 },
    { key: 'project',   width: 22 }, { key: 'city',      width: 14 },
    { key: 'date',      width: 14 }, { key: 'time',      width: 12 },
    { key: 'status',    width: 14 }, { key: 'assigned',  width: 20 },
    { key: 'transport', width: 12 }, { key: 'reaction',  width: 18 },
    { key: 'next_step', width: 18 }, { key: 'rating',    width: 10 },
    { key: 'notes',     width: 30 },
  ]
  const h = ws.getRow(2)
  h.values = ['#','Lead Name','Phone','Email','Project','City','Visit Date','Time',
    'Status','Assigned To','Transport','Client Reaction','Next Step','Rating','Notes']
  styleHeader(h, 'FF6D28D9')

  rows.rows.forEach((r, i) => {
    const sc  = SV_STATUS_COLOR[r.status] || { fill: 'FFF9FAFB', font: '111827' }
    const row = ws.addRow({
      sno: i + 1, lead: r.lead_name, phone: r.lead_phone, email: r.lead_email || '—',
      project: r.project_name, city: r.project_city || '—',
      date: fmtDate(r.visit_date),
      time: r.visit_time ? r.visit_time.substring(0, 5) : '—',
      status: (r.status || '').toUpperCase(),
      assigned: r.assigned_to_name || '—',
      transport: r.transport_arranged ? 'Yes' : 'No',
      reaction: (r.client_reaction || '—').replace(/_/g, ' '),
      next_step: (r.next_step || '—').replace(/_/g, ' '),
      rating: r.rating || '—',
      notes: r.notes || '—',
    })
    row.height = 20
    const sc2 = row.getCell('status')
    sc2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sc.fill } }
    sc2.font = { bold: true, size: 9, color: { argb: `FF${sc.font}` } }
    sc2.alignment = { horizontal: 'center', vertical: 'middle' }
    shadeRow(row, i)
  })
  ws.autoFilter = { from: 'A2', to: 'O2' }
  return rows.rows.length
}

// ─────────────────────────────────────────────────────────────────────────────
// ── FOLLOW-UPS / TASKS EXPORT ─────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

const buildFollowUpsSheet = async (wb, user, start, end) => {
  const admin = isAdmin(user)
  const conditions = [`t.due_date::date BETWEEN $1 AND $2`]
  const params = [start, end]
  let idx = 3
  if (!admin) { conditions.push(`t.assigned_to = $${idx++}`); params.push(user.id) }

  const rows = await pool.query(
    `SELECT t.id, t.title, t.notes, t.priority, t.due_date,
            t.is_completed, t.completed_at, t.created_at,
            l.name  AS lead_name, l.phone AS lead_phone, l.status AS lead_status,
            p.name  AS project_name,
            CONCAT(a.first_name,' ',a.last_name) AS assigned_to_name,
            CONCAT(c.first_name,' ',c.last_name) AS created_by_name
     FROM tasks t
     LEFT JOIN leads    l ON l.id = t.lead_id
     LEFT JOIN projects p ON p.id = l.project_id
     LEFT JOIN users    a ON a.id = t.assigned_to
     LEFT JOIN users    c ON c.id = t.created_by
     WHERE ${conditions.join(' AND ')}
     ORDER BY t.is_completed ASC, t.due_date ASC`,
    params
  )

  const PRIORITY_COLOR = {
    high:   { fill: 'FFFEE2E2', font: '991B1B' },
    medium: { fill: 'FFFEF3C7', font: '92400E' },
    low:    { fill: 'FFD1FAE5', font: '065F46' },
  }

  const ws = wb.addWorksheet('Follow-Ups', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
    properties: { tabColor: { argb: 'FF10B981' } },
  })
  addTitle(ws, `Follow-Ups / Tasks  |  ${fmtDate(start)} – ${fmtDate(end)}`, 13, 'FF059669')
  ws.columns = [
    { key: 'sno',       width: 5  }, { key: 'title',     width: 28 },
    { key: 'priority',  width: 12 }, { key: 'status',    width: 14 },
    { key: 'due',       width: 18 }, { key: 'completed', width: 18 },
    { key: 'lead',      width: 22 }, { key: 'phone',     width: 15 },
    { key: 'lead_st',   width: 18 }, { key: 'project',   width: 22 },
    { key: 'assigned',  width: 20 }, { key: 'created_by',width: 18 },
    { key: 'notes',     width: 30 },
  ]
  const h = ws.getRow(2)
  h.values = ['#','Title','Priority','Status','Due Date','Completed At',
    'Lead Name','Lead Phone','Lead Status','Project','Assigned To','Created By','Notes']
  styleHeader(h, 'FF059669')

  rows.rows.forEach((r, i) => {
    const pc  = PRIORITY_COLOR[r.priority] || { fill: 'FFF9FAFB', font: '111827' }
    const row = ws.addRow({
      sno: i + 1, title: r.title,
      priority: (r.priority || '').toUpperCase(),
      status: r.is_completed ? 'COMPLETED' : 'PENDING',
      due: fmtDateTime(r.due_date), completed: r.completed_at ? fmtDateTime(r.completed_at) : '—',
      lead: r.lead_name || '—', phone: r.lead_phone || '—',
      lead_st: (r.lead_status || '—').replace(/_/g, ' '),
      project: r.project_name || '—',
      assigned: r.assigned_to_name || '—', created_by: r.created_by_name || '—',
      notes: r.notes || '—',
    })
    row.height = 20
    const pc2 = row.getCell('priority')
    pc2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pc.fill } }
    pc2.font = { bold: true, size: 9, color: { argb: `FF${pc.font}` } }
    pc2.alignment = { horizontal: 'center', vertical: 'middle' }
    const sc = row.getCell('status')
    sc.fill = r.is_completed
      ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }
      : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
    sc.font = { bold: true, size: 9, color: { argb: r.is_completed ? 'FF065F46' : 'FF92400E' } }
    sc.alignment = { horizontal: 'center', vertical: 'middle' }
    shadeRow(row, i)
  })
  ws.autoFilter = { from: 'A2', to: 'M2' }
  return rows.rows.length
}

// ─────────────────────────────────────────────────────────────────────────────
// ── PROJECTS EXPORT (admin only) ─────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

const buildProjectsSheet = async (wb) => {
  const rows = await pool.query(
    `SELECT p.*,
            CONCAT(u.first_name,' ',u.last_name) AS created_by_name,
            (SELECT COUNT(*) FROM leads WHERE project_id = p.id AND is_archived = false) AS total_leads,
            (SELECT COUNT(*) FROM leads WHERE project_id = p.id AND status = 'booked' AND is_archived = false) AS booked_leads,
            (SELECT COUNT(*) FROM site_visits WHERE project_id = p.id) AS total_visits
     FROM projects p
     LEFT JOIN users u ON u.id = p.created_by
     ORDER BY p.created_at DESC`
  )

  const ws = wb.addWorksheet('Projects', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
    properties: { tabColor: { argb: 'FFF59E0B' } },
  })
  addTitle(ws, `Projects  |  All Active & Inactive`, 15, 'FFB45309')
  ws.columns = [
    { key: 'sno',       width: 5  }, { key: 'name',      width: 26 },
    { key: 'developer', width: 22 }, { key: 'city',      width: 16 },
    { key: 'locality',  width: 18 }, { key: 'type',      width: 14 },
    { key: 'price',     width: 18 }, { key: 'units',     width: 12 },
    { key: 'status',    width: 14 }, { key: 'rera',      width: 20 },
    { key: 'leads',     width: 12 }, { key: 'booked',    width: 12 },
    { key: 'visits',    width: 12 }, { key: 'possession',width: 16 },
    { key: 'created_by',width: 20 },
  ]
  const h = ws.getRow(2)
  h.values = ['#','Project Name','Developer','City','Locality','Type','Price Range',
    'Total Units','Status','RERA No.','Total Leads','Booked','Site Visits','Possession','Created By']
  styleHeader(h, 'FFB45309')

  const STATUS_C = {
    active:    { fill: 'FFD1FAE5', font: '065F46' },
    inactive:  { fill: 'FFFEE2E2', font: '991B1B' },
    upcoming:  { fill: 'FFCFFAFE', font: '164E63' },
    completed: { fill: 'FFE0E7FF', font: '3730A3' },
  }

  rows.rows.forEach((r, i) => {
    const sc  = STATUS_C[r.status] || { fill: 'FFF9FAFB', font: '111827' }
    const row = ws.addRow({
      sno: i + 1, name: r.name, developer: r.developer || '—',
      city: r.city, locality: r.locality || '—', type: '—',
      price: r.price_range || '—', units: r.total_units || '—',
      status: (r.status || '').toUpperCase(), rera: r.rera_number || '—',
      leads: parseInt(r.total_leads) || 0, booked: parseInt(r.booked_leads) || 0,
      visits: parseInt(r.total_visits) || 0,
      possession: r.possession_date ? fmtDate(r.possession_date) : '—',
      created_by: r.created_by_name || '—',
    })
    row.height = 20
    const sc2 = row.getCell('status')
    sc2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sc.fill } }
    sc2.font = { bold: true, size: 9, color: { argb: `FF${sc.font}` } }
    sc2.alignment = { horizontal: 'center', vertical: 'middle' }
    shadeRow(row, i)
  })
  ws.autoFilter = { from: 'A2', to: 'O2' }
  return rows.rows.length
}

// ─────────────────────────────────────────────────────────────────────────────
// ── USERS EXPORT (admin only) ─────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

const buildUsersSheet = async (wb) => {
  const rows = await pool.query(
    `SELECT u.*,
            CONCAT(m.first_name,' ',m.last_name) AS manager_name,
            (SELECT COUNT(*) FROM leads WHERE assigned_to = u.id AND is_archived = false) AS total_leads,
            (SELECT COUNT(*) FROM leads WHERE assigned_to = u.id AND status = 'booked' AND is_archived = false) AS booked,
            (SELECT COUNT(*) FROM site_visits WHERE assigned_to = u.id) AS total_visits,
            (SELECT COUNT(*) FROM tasks WHERE assigned_to = u.id AND is_completed = false) AS pending_tasks
     FROM users u
     LEFT JOIN users m ON m.id = u.manager_id
     ORDER BY u.role ASC, u.first_name ASC`
  )

  const ws = wb.addWorksheet('Users', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
    properties: { tabColor: { argb: 'FFEC4899' } },
  })
  addTitle(ws, `Users / Team  |  All Members`, 13, 'FF9D174D')
  ws.columns = [
    { key: 'sno',       width: 5  }, { key: 'name',      width: 24 },
    { key: 'role',      width: 18 }, { key: 'email',     width: 28 },
    { key: 'phone',     width: 16 }, { key: 'manager',   width: 22 },
    { key: 'active',    width: 10 }, { key: 'leads',     width: 12 },
    { key: 'booked',    width: 12 }, { key: 'visits',    width: 12 },
    { key: 'tasks',     width: 14 }, { key: 'joined',    width: 16 },
    { key: 'last_login',width: 18 },
  ]
  const h = ws.getRow(2)
  h.values = ['#','Full Name','Role','Email','Phone','Reporting Manager',
    'Active?','Total Leads','Booked','Site Visits','Pending Tasks','Joined','Last Login']
  styleHeader(h, 'FF9D174D')

  rows.rows.forEach((r, i) => {
    const row = ws.addRow({
      sno: i + 1,
      name: `${r.first_name} ${r.last_name || ''}`.trim(),
      role: (r.role || '').replace(/_/g, ' ').toUpperCase(),
      email: r.email, phone: r.phone_number || '—',
      manager: r.manager_name || '—',
      active: r.is_active ? 'Yes' : 'No',
      leads: parseInt(r.total_leads) || 0, booked: parseInt(r.booked) || 0,
      visits: parseInt(r.total_visits) || 0, tasks: parseInt(r.pending_tasks) || 0,
      joined: r.created_at ? fmtDate(r.created_at) : '—',
      last_login: r.last_login_at ? fmtDateTime(r.last_login_at) : '—',
    })
    row.height = 20
    const ac = row.getCell('active')
    ac.fill = r.is_active
      ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }
      : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
    ac.font = { bold: true, size: 9, color: { argb: r.is_active ? 'FF065F46' : 'FF991B1B' } }
    ac.alignment = { horizontal: 'center', vertical: 'middle' }
    shadeRow(row, i)
  })
  ws.autoFilter = { from: 'A2', to: 'M2' }
  return rows.rows.length
}

// ─────────────────────────────────────────────────────────────────────────────
// ── ATTENDANCE EXPORT ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_FILL = {
  present:  { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD1FAE5' } },
  late:     { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFEF3C7' } },
  absent:   { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFEE2E2' } },
  on_leave: { type:'pattern', pattern:'solid', fgColor:{ argb:'FFE0E7FF' } },
  half_day: { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFCE7F3' } },
  weekend:  { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF3F4F6' } },
}
const STATUS_FONT = { present:'065F46', late:'92400E', absent:'991B1B', on_leave:'3730A3', half_day:'9D174D', weekend:'6B7280' }

const buildAttendanceSheets = async (wb, user, start, end) => {
  const admin = isAdmin(user)
  const uFilter = admin ? '' : `AND a.user_id='${user.id}'`
  const usrFilter = admin ? '' : `AND u.id='${user.id}'`

  const [allRecs, usersRes] = await Promise.all([
    pool.query(`SELECT a.*,CONCAT(u.first_name,' ',u.last_name) AS full_name,u.role,u.email FROM attendance a JOIN users u ON u.id=a.user_id WHERE a.date BETWEEN $1 AND $2 ${uFilter} ORDER BY a.date ASC,u.first_name ASC`,[start,end]),
    pool.query(`SELECT id,first_name,last_name,role,email FROM users WHERE is_active=true ${usrFilter} ORDER BY first_name ASC`),
  ])

  const allDays = []
  const cur = new Date(start)
  while (cur <= new Date(end)) { allDays.push(cur.toISOString().split('T')[0]); cur.setDate(cur.getDate() + 1) }

  const lookup = {}
  allRecs.rows.forEach(r => { const d = toDateStr(r.date); if (!lookup[r.user_id]) lookup[r.user_id] = {}; lookup[r.user_id][d] = r })

  // ── All Records tab ───────────────────────────────────────────────────────
  const ws1 = wb.addWorksheet('Attendance Records', { views:[{state:'frozen',xSplit:0,ySplit:2}], properties:{tabColor:{argb:'FF1E40AF'}} })
  addTitle(ws1, `Attendance Records  |  ${fmtDate(start)} – ${fmtDate(end)}`, 12, 'FF1E3A8A')
  ws1.columns = [
    {key:'sno',width:5},{key:'name',width:24},{key:'role',width:18},{key:'date',width:14},
    {key:'status',width:14},{key:'in',width:12},{key:'out',width:12},{key:'wh',width:12},
    {key:'loc',width:26},{key:'manual',width:10},{key:'reason',width:22},{key:'email',width:26},
  ]
  const h1 = ws1.getRow(2)
  h1.values = ['#','Name','Role','Date','Status','Check-In','Check-Out','Working Hrs','Location','Manual?','Reason','Email']
  styleHeader(h1, 'FF1E3A8A')
  allRecs.rows.forEach((r, i) => {
    const d   = toDateStr(r.date)
    const row = ws1.addRow({ sno:i+1, name:r.full_name, role:(r.role||'').replace(/_/g,' '), date:fmtDate(d), status:(r.status||'').toUpperCase(), in:fmtTime(r.check_in_time), out:fmtTime(r.check_out_time), wh:r.working_hours?`${r.working_hours}h`:'—', loc:r.checkin_address||'—', manual:r.is_manual_entry?'Yes':'No', reason:r.reason||'—', email:r.email })
    row.height = 20
    const sc = row.getCell('status')
    if (STATUS_FILL[r.status]) sc.fill = STATUS_FILL[r.status]
    sc.font = { bold:true, size:9, color:{ argb:`FF${STATUS_FONT[r.status]||'111827'}` } }
    sc.alignment = { horizontal:'center', vertical:'middle' }
    shadeRow(row, i)
  })
  ws1.autoFilter = { from:'A2', to:'L2' }

  // ── Monthly Grid tab ──────────────────────────────────────────────────────
  const ws2 = wb.addWorksheet('Monthly Grid', { views:[{state:'frozen',xSplit:3,ySplit:3}], properties:{tabColor:{argb:'FF059669'}} })
  addTitle(ws2, `Monthly Grid  |  ${fmtDate(start)} – ${fmtDate(end)}`, 3 + allDays.length, 'FF065F46')
  const dow = ws2.getRow(2)
  ;[1,2,3].forEach(c => { dow.getCell(c).value = '' })
  allDays.forEach((d, i) => {
    const isWk = [0,6].includes(new Date(d).getDay())
    const cell = dow.getCell(4 + i)
    cell.value = new Date(d).toLocaleDateString('en-IN', { weekday:'short' })
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:isWk?'FFE5E7EB':'FFD1FAE5' } }
    cell.font = { bold:true, size:8, color:{ argb:isWk?'FF6B7280':'FF065F46' } }
    cell.alignment = { horizontal:'center', vertical:'middle' }
  })
  ws2.getRow(2).height = 16
  const dr = ws2.getRow(3)
  dr.getCell(1).value='#'; dr.getCell(2).value='Employee'; dr.getCell(3).value='Role'
  ;[1,2,3].forEach(c => styleHeader(dr.getCell(c), 'FF065F46'))
  allDays.forEach((d, i) => {
    const isWk = [0,6].includes(new Date(d).getDay())
    const cell = dr.getCell(4 + i)
    cell.value = parseInt(d.split('-')[2])
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:isWk?'FFD1D5DB':'FF1E40AF' } }
    cell.font = { bold:true, size:8, color:{ argb:'FFFFFFFF' } }
    cell.alignment = { horizontal:'center', vertical:'middle' }
  })
  ws2.getRow(3).height = 22
  ws2.getColumn(1).width=5; ws2.getColumn(2).width=22; ws2.getColumn(3).width=15
  allDays.forEach((_, i) => { ws2.getColumn(4 + i).width = 4.5 })

  usersRes.rows.forEach((u, ui) => {
    const row = ws2.getRow(4 + ui)
    row.getCell(1).value = ui + 1
    row.getCell(2).value = `${u.first_name} ${u.last_name||''}`.trim()
    row.getCell(3).value = u.role?.replace(/_/g,' ')
    ;[1,2,3].forEach(c => { row.getCell(c).font={size:10}; row.getCell(c).alignment={vertical:'middle'} })
    allDays.forEach((d, i) => {
      const isWk = [0,6].includes(new Date(d).getDay())
      const rec  = lookup[u.id]?.[d]
      const st   = rec?.status || (isWk ? 'weekend' : 'absent')
      const abbr = { present:'P', late:'L', absent:'A', on_leave:'OL', half_day:'H', weekend:'-' }
      const cell = row.getCell(4 + i)
      cell.value = abbr[st] || st.charAt(0).toUpperCase()
      cell.alignment = { horizontal:'center', vertical:'middle' }
      cell.font = { size:8, bold:true, color:{ argb:`FF${STATUS_FONT[st]||'111827'}` } }
      if (STATUS_FILL[st]) cell.fill = STATUS_FILL[st]
    })
    row.height = 18
  })

  // ── Summary tab ───────────────────────────────────────────────────────────
  const ws3 = wb.addWorksheet('Attendance Summary', { views:[{state:'frozen',xSplit:0,ySplit:2}], properties:{tabColor:{argb:'FF7C3AED'}} })
  addTitle(ws3, `Attendance Summary  |  ${fmtDate(start)} – ${fmtDate(end)}`, 11, 'FF4C1D95')
  ws3.columns = [{key:'sno',width:5},{key:'name',width:24},{key:'role',width:18},{key:'present',width:10},{key:'late',width:8},{key:'absent',width:10},{key:'leave',width:10},{key:'wh',width:14},{key:'pct',width:14},{key:'last',width:16},{key:'email',width:26}]
  const h3 = ws3.getRow(2)
  h3.values = ['#','Employee','Role','Present','Late','Absent','On Leave','Working Hrs','Attend %','Last Seen','Email']
  styleHeader(h3, 'FF4C1D95')

  const sr = await pool.query(`SELECT u.id,CONCAT(u.first_name,' ',u.last_name) AS full_name,u.role,u.email,COUNT(a.id) FILTER(WHERE a.status IN('present','late')) AS present,COUNT(a.id) FILTER(WHERE a.status='late') AS late,COUNT(a.id) FILTER(WHERE a.status='absent') AS absent,COUNT(a.id) FILTER(WHERE a.status IN('on_leave','half_day')) AS on_leave,COUNT(a.id) AS total_days,COALESCE(SUM(a.working_hours),0) AS total_wh,MAX(a.date) FILTER(WHERE a.check_in_time IS NOT NULL) AS last_present FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND a.date BETWEEN $1 AND $2 WHERE u.is_active=true ${usrFilter} GROUP BY u.id ORDER BY u.first_name ASC`,[start,end])

  sr.rows.forEach((r, i) => {
    const pct = parseInt(r.total_days)>0 ? ((parseInt(r.present)/parseInt(r.total_days))*100).toFixed(1) : 0
    const row = ws3.addRow({ sno:i+1, name:r.full_name, role:r.role?.replace(/_/g,' '), present:parseInt(r.present), late:parseInt(r.late), absent:parseInt(r.absent), leave:parseInt(r.on_leave), wh:`${parseFloat(r.total_wh).toFixed(1)}h`, pct:`${pct}%`, last:r.last_present?fmtDate(r.last_present):'—', email:r.email })
    row.height = 20
    const pc = row.getCell('pct')
    const pn = parseFloat(pct)
    pc.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:pn>=90?'FFD1FAE5':pn>=75?'FFFEF3C7':'FFFEE2E2' } }
    pc.font = { bold:true, color:{ argb:`FF${pn>=90?'065F46':pn>=75?'92400E':'991B1B'}` } }
    shadeRow(row, i)
  })
  ws3.autoFilter = { from:'A2', to:'K2' }
  return allRecs.rows.length
}

// ─────────────────────────────────────────────────────────────────────────────
// ── ROUTE HANDLERS ───────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

const exportLeads = async (req, res, next) => {
  try {
    const { from, to, project_id } = req.query
    const { start, end } = defaultRange(from, to)
    const wb = new ExcelJS.Workbook()
    wb.creator = 'NextOne Realty CRM'; wb.created = new Date()
    await buildLeadsSheet(wb, req.user, start, end, project_id)
    await streamWorkbook(res, wb, `Leads_${start}_${end}.xlsx`)
  } catch (err) { next(err) }
}

const exportSiteVisits = async (req, res, next) => {
  try {
    const { from, to, project_id } = req.query
    const { start, end } = defaultRange(from, to)
    const wb = new ExcelJS.Workbook()
    wb.creator = 'NextOne Realty CRM'; wb.created = new Date()
    await buildSiteVisitsSheet(wb, req.user, start, end, project_id)
    await streamWorkbook(res, wb, `SiteVisits_${start}_${end}.xlsx`)
  } catch (err) { next(err) }
}

const exportFollowUps = async (req, res, next) => {
  try {
    const { from, to } = req.query
    const { start, end } = defaultRange(from, to)
    const wb = new ExcelJS.Workbook()
    wb.creator = 'NextOne Realty CRM'; wb.created = new Date()
    await buildFollowUpsSheet(wb, req.user, start, end)
    await streamWorkbook(res, wb, `FollowUps_${start}_${end}.xlsx`)
  } catch (err) { next(err) }
}

const exportProjects = async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) return next(new AppError('Admin access required', 403))
    const wb = new ExcelJS.Workbook()
    wb.creator = 'NextOne Realty CRM'; wb.created = new Date()
    await buildProjectsSheet(wb)
    await streamWorkbook(res, wb, `Projects_${new Date().toISOString().split('T')[0]}.xlsx`)
  } catch (err) { next(err) }
}

const exportUsers = async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) return next(new AppError('Admin access required', 403))
    const wb = new ExcelJS.Workbook()
    wb.creator = 'NextOne Realty CRM'; wb.created = new Date()
    await buildUsersSheet(wb)
    await streamWorkbook(res, wb, `Users_${new Date().toISOString().split('T')[0]}.xlsx`)
  } catch (err) { next(err) }
}

const exportAttendance = async (req, res, next) => {
  try {
    const { from, to } = req.query
    const { start, end } = defaultRange(from, to)
    const wb = new ExcelJS.Workbook()
    wb.creator = 'NextOne Realty CRM'; wb.created = new Date()
    await buildAttendanceSheets(wb, req.user, start, end)
    await streamWorkbook(res, wb, `Attendance_${start}_${end}.xlsx`)
  } catch (err) { next(err) }
}

const exportAll = async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) return next(new AppError('Admin access required', 403))
    const { from, to } = req.query
    const { start, end } = defaultRange(from, to)
    const wb = new ExcelJS.Workbook()
    wb.creator = 'NextOne Realty CRM'; wb.created = new Date()
    await buildLeadsSheet(wb, req.user, start, end, null)
    await buildSiteVisitsSheet(wb, req.user, start, end, null)
    await buildFollowUpsSheet(wb, req.user, start, end)
    await buildProjectsSheet(wb)
    await buildUsersSheet(wb)
    await buildAttendanceSheets(wb, req.user, start, end)
    await streamWorkbook(res, wb, `NextOne_CRM_Export_${start}_${end}.xlsx`)
  } catch (err) { next(err) }
}

module.exports = {
  exportLeads, exportSiteVisits, exportFollowUps,
  exportProjects, exportUsers, exportAttendance, exportAll,
}