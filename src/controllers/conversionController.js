/**
 * conversionController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles converting one module record into another.
 *
 *  POST /api/v1/convert/lead/:leadId/to-follow-up
 *       Convert a lead into a follow-up task. Optionally updates lead status.
 *       Required body: title, due_date
 *       Optional body: priority, notes, assigned_to
 *
 *  POST /api/v1/convert/lead/:leadId/to-site-visit
 *       Convert a lead into a site visit. Updates lead status to site_visit_scheduled.
 *       Required body: visit_date, visit_time, project_id
 *       Optional body: assigned_to, transport_arranged, notes
 *
 *  POST /api/v1/convert/follow-up/:taskId/to-site-visit
 *       Convert an existing follow-up task into a site visit.
 *       Marks the task completed and creates a site visit for the same lead.
 *       Required body: visit_date, visit_time, project_id
 *       Optional body: assigned_to, transport_arranged, notes
 *
 *  GET  /api/v1/convert/lead/:leadId/options
 *       Returns the required fields schema for each conversion type,
 *       plus current lead info so the UI can pre-fill forms.
 *
 *  GET  /api/v1/convert/follow-up/:taskId/options
 *       Returns the required fields schema for site-visit conversion,
 *       plus current task + lead info for pre-filling.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { pool }   = require('../config/db')
const { sendSuccess } = require('../utils/response')
const AppError   = require('../utils/AppError')

// ─── Schema definitions returned by /options endpoints ────────────────────────
// Tells the frontend exactly what fields to show in the modal, with type & validation

const FOLLOW_UP_FIELDS = [
  {
    key:         'title',
    label:       'Follow-up Title',
    type:        'text',
    required:    true,
    placeholder: 'e.g. Call back regarding 2BHK pricing',
    maxLength:   255,
  },
  {
    key:         'due_date',
    label:       'Due Date & Time',
    type:        'datetime',
    required:    true,
    hint:        'When should this follow-up be completed?',
  },
  {
    key:         'priority',
    label:       'Priority',
    type:        'select',
    required:    false,
    default:     'medium',
    options:     [
      { value: 'low',    label: 'Low'    },
      { value: 'medium', label: 'Medium' },
      { value: 'high',   label: 'High'   },
    ],
  },
  {
    key:         'assigned_to',
    label:       'Assign To',
    type:        'user_select',
    required:    false,
    hint:        'Leave blank to keep current lead assignment',
  },
  {
    key:         'notes',
    label:       'Notes',
    type:        'textarea',
    required:    false,
    placeholder: 'Any additional context or instructions…',
    maxLength:   1000,
  },
]

const SITE_VISIT_FIELDS = [
  {
    key:         'project_id',
    label:       'Project',
    type:        'project_select',
    required:    true,
    hint:        'Which project will the client visit?',
  },
  {
    key:         'visit_date',
    label:       'Visit Date',
    type:        'date',
    required:    true,
    hint:        'Must be today or a future date',
    minDate:     'today',
  },
  {
    key:         'visit_time',
    label:       'Visit Time',
    type:        'time',
    required:    true,
    placeholder: 'HH:MM',
  },
  {
    key:         'assigned_to',
    label:       'Assign To',
    type:        'user_select',
    required:    false,
    hint:        'Who will escort the client?',
  },
  {
    key:         'transport_arranged',
    label:       'Transport Arranged?',
    type:        'boolean',
    required:    false,
    default:     false,
  },
  {
    key:         'notes',
    label:       'Notes',
    type:        'textarea',
    required:    false,
    placeholder: 'Any special instructions for the visit…',
    maxLength:   1000,
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getLeadOrFail = async (leadId, caller) => {
  const result = await pool.query(
    `SELECT l.*, p.name AS project_name,
            CONCAT(u.first_name,' ',u.last_name) AS assigned_to_name
     FROM leads l
     LEFT JOIN projects p ON p.id = l.project_id
     LEFT JOIN users    u ON u.id = l.assigned_to
     WHERE l.id = $1 AND l.is_archived = false`,
    [leadId]
  )
  if (!result.rows.length) throw new AppError('Lead not found', 404)
  return result.rows[0]
}

const getTaskOrFail = async (taskId) => {
  const result = await pool.query(
    `SELECT t.*, l.name AS lead_name, l.phone AS lead_phone,
            l.project_id AS lead_project_id, l.assigned_to AS lead_assigned_to,
            p.name AS project_name,
            CONCAT(u.first_name,' ',u.last_name) AS assigned_to_name
     FROM tasks t
     LEFT JOIN leads    l ON l.id = t.lead_id
     LEFT JOIN projects p ON p.id = l.project_id
     LEFT JOIN users    u ON u.id = t.assigned_to
     WHERE t.id = $1`,
    [taskId]
  )
  if (!result.rows.length) throw new AppError('Follow-up not found', 404)
  return result.rows[0]
}

const logActivity = async (client, leadId, type, note, userId) => {
  await client.query(
    `INSERT INTO lead_activities (lead_id, type, note, performed_by)
     VALUES ($1, $2, $3, $4)`,
    [leadId, type, note, userId]
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/convert/lead/:leadId/options
// Returns field schema + pre-filled lead data for the frontend modal
// ─────────────────────────────────────────────────────────────────────────────
const getLeadConversionOptions = async (req, res, next) => {
  try {
    const lead = await getLeadOrFail(req.params.leadId, req.user)

    // Fetch active users for assign dropdown and projects for project select
    const [usersRes, projectsRes] = await Promise.all([
      pool.query(
        `SELECT id, CONCAT(first_name,' ',last_name) AS name, role
         FROM users WHERE is_active = true AND role IN ('sales_executive','sales_manager')
         ORDER BY first_name`
      ),
      pool.query(
        `SELECT id, name, city, locality
         FROM projects WHERE status IN ('active','upcoming')
         ORDER BY name`
      ),
    ])

    return sendSuccess(res, 'Lead conversion options', {
      lead: {
        id:                 lead.id,
        name:               lead.name,
        phone:              lead.phone,
        email:              lead.email,
        status:             lead.status,
        source:             lead.source,
        budget:             lead.budget,
        project_id:         lead.project_id,
        project_name:       lead.project_name,
        assigned_to:        lead.assigned_to,
        assigned_to_name:   lead.assigned_to_name,
      },
      conversions: {
        to_follow_up: {
          label:            'Convert to Follow-Up',
          description:      'Create a follow-up task linked to this lead',
          available:        true,
          fields:           FOLLOW_UP_FIELDS,
          prefill: {
            title:          `Follow-up with ${lead.name}`,
            assigned_to:    lead.assigned_to,
            priority:       'medium',
          },
        },
        to_site_visit: {
          label:            'Convert to Site Visit',
          description:      'Schedule a site visit for this lead',
          available:        !['booked','lost'].includes(lead.status),
          unavailable_reason: ['booked','lost'].includes(lead.status)
            ? `Cannot schedule a site visit for a lead with status "${lead.status}"`
            : null,
          fields:           SITE_VISIT_FIELDS,
          prefill: {
            project_id:          lead.project_id,
            assigned_to:         lead.assigned_to,
            transport_arranged:  false,
          },
        },
      },
      users:    usersRes.rows,
      projects: projectsRes.rows,
    })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/convert/follow-up/:taskId/options
// ─────────────────────────────────────────────────────────────────────────────
const getFollowUpConversionOptions = async (req, res, next) => {
  try {
    const task = await getTaskOrFail(req.params.taskId)

    const [usersRes, projectsRes] = await Promise.all([
      pool.query(
        `SELECT id, CONCAT(first_name,' ',last_name) AS name, role
         FROM users WHERE is_active = true AND role IN ('sales_executive','sales_manager')
         ORDER BY first_name`
      ),
      pool.query(
        `SELECT id, name, city, locality
         FROM projects WHERE status IN ('active','upcoming')
         ORDER BY name`
      ),
    ])

    return sendSuccess(res, 'Follow-up conversion options', {
      task: {
        id:           task.id,
        title:        task.title,
        notes:        task.notes,
        priority:     task.priority,
        due_date:     task.due_date,
        is_completed: task.is_completed,
        lead_id:      task.lead_id,
        lead_name:    task.lead_name,
        lead_phone:   task.lead_phone,
        assigned_to:  task.assigned_to,
        assigned_to_name: task.assigned_to_name,
        project_name: task.project_name,
      },
      conversions: {
        to_site_visit: {
          label:       'Convert to Site Visit',
          description: 'Schedule a site visit for this lead and mark follow-up as completed',
          available:   !!task.lead_id,
          unavailable_reason: !task.lead_id
            ? 'This follow-up is not linked to any lead'
            : null,
          fields:  SITE_VISIT_FIELDS,
          prefill: {
            project_id:         task.lead_project_id,
            assigned_to:        task.assigned_to || task.lead_assigned_to,
            transport_arranged: false,
          },
        },
      },
      users:    usersRes.rows,
      projects: projectsRes.rows,
    })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/convert/lead/:leadId/to-follow-up
// ─────────────────────────────────────────────────────────────────────────────
const convertLeadToFollowUp = async (req, res, next) => {
  const client = await pool.connect()
  try {
    const { leadId } = req.params
    const {
      title,
      due_date,
      priority    = 'medium',
      assigned_to,
      notes,
    } = req.body

    // ── Validation ────────────────────────────────────────────────────────
    if (!title?.trim())  throw new AppError('title is required', 400)
    if (!due_date)       throw new AppError('due_date is required', 400)

    const dueDateObj = new Date(due_date)
    if (isNaN(dueDateObj)) throw new AppError('due_date must be a valid ISO datetime', 400)

    const lead = await getLeadOrFail(leadId, req.user)

    await client.query('BEGIN')

    // 1. Create the follow-up task
    const taskResult = await client.query(
      `INSERT INTO tasks
         (title, lead_id, due_date, assigned_to, created_by, priority, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        title.trim(),
        leadId,
        dueDateObj.toISOString(),
        assigned_to || lead.assigned_to,
        req.user.id,
        ['low','medium','high'].includes(priority) ? priority : 'medium',
        notes || null,
      ]
    )
    const task = taskResult.rows[0]

    // 2. Update lead status to follow_up (only if it makes sense to progress)
    const PROGRESSABLE = ['new','contacted','interested']
    if (PROGRESSABLE.includes(lead.status)) {
      await client.query(
        `UPDATE leads SET status = 'follow_up', updated_at = NOW() WHERE id = $1`,
        [leadId]
      )
    }

    // 3. Log activity on the lead
    await logActivity(
      client,
      leadId,
      'note',
      `Follow-up created: "${title.trim()}" — due ${dueDateObj.toLocaleDateString('en-IN')}`,
      req.user.id
    )

    await client.query('COMMIT')

    return sendSuccess(res, 'Lead converted to follow-up successfully', {
      conversion: {
        type:       'lead_to_follow_up',
        lead_id:    leadId,
        lead_name:  lead.name,
        lead_status_updated_to: PROGRESSABLE.includes(lead.status) ? 'follow_up' : lead.status,
      },
      task: {
        id:          task.id,
        title:       task.title,
        due_date:    task.due_date,
        priority:    task.priority,
        assigned_to: task.assigned_to,
        notes:       task.notes,
        lead_id:     task.lead_id,
        created_at:  task.created_at,
      },
    }, 201)
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/convert/lead/:leadId/to-site-visit
// ─────────────────────────────────────────────────────────────────────────────
const convertLeadToSiteVisit = async (req, res, next) => {
  const client = await pool.connect()
  try {
    const { leadId } = req.params
    const {
      project_id,
      visit_date,
      visit_time,
      assigned_to,
      transport_arranged = false,
      notes,
    } = req.body

    // ── Validation ────────────────────────────────────────────────────────
    if (!project_id)  throw new AppError('project_id is required', 400)
    if (!visit_date)  throw new AppError('visit_date is required (YYYY-MM-DD)', 400)
    if (!visit_time)  throw new AppError('visit_time is required (HH:MM)', 400)

    const lead = await getLeadOrFail(leadId, req.user)

    if (['booked','lost'].includes(lead.status)) {
      throw new AppError(
        `Cannot convert a lead with status "${lead.status}" to a site visit`,
        422
      )
    }

    // Verify project exists
    const projectCheck = await pool.query(
      `SELECT id, name FROM projects WHERE id = $1`,
      [project_id]
    )
    if (!projectCheck.rows.length) throw new AppError('Project not found', 404)

    await client.query('BEGIN')

    // 1. Create the site visit
    const svResult = await client.query(
      `INSERT INTO site_visits
         (lead_id, project_id, visit_date, visit_time, assigned_to,
          status, transport_arranged, notes)
       VALUES ($1, $2, $3, $4, $5, 'scheduled', $6, $7)
       RETURNING *`,
      [
        leadId,
        project_id,
        visit_date,
        visit_time,
        assigned_to || lead.assigned_to,
        Boolean(transport_arranged),
        notes || null,
      ]
    )
    const sv = svResult.rows[0]

    // 2. Update lead status to site_visit_scheduled
    await client.query(
      `UPDATE leads
       SET status     = 'site_visit_scheduled',
           project_id = COALESCE($2, project_id),
           updated_at = NOW()
       WHERE id = $1`,
      [leadId, project_id]
    )

    // 3. Log activity
    const proj = projectCheck.rows[0]
    await logActivity(
      client,
      leadId,
      'status_change',
      `Site visit scheduled at ${proj.name} on ${visit_date} at ${visit_time}`,
      req.user.id
    )

    await client.query('COMMIT')

    return sendSuccess(res, 'Lead converted to site visit successfully', {
      conversion: {
        type:       'lead_to_site_visit',
        lead_id:    leadId,
        lead_name:  lead.name,
        lead_status_updated_to: 'site_visit_scheduled',
      },
      site_visit: {
        id:                 sv.id,
        lead_id:            sv.lead_id,
        project_id:         sv.project_id,
        project_name:       proj.name,
        visit_date:         sv.visit_date,
        visit_time:         sv.visit_time,
        status:             sv.status,
        assigned_to:        sv.assigned_to,
        transport_arranged: sv.transport_arranged,
        notes:              sv.notes,
        created_at:         sv.created_at,
      },
    }, 201)
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/convert/follow-up/:taskId/to-site-visit
// ─────────────────────────────────────────────────────────────────────────────
const convertFollowUpToSiteVisit = async (req, res, next) => {
  const client = await pool.connect()
  try {
    const { taskId } = req.params
    const {
      project_id,
      visit_date,
      visit_time,
      assigned_to,
      transport_arranged = false,
      notes,
    } = req.body

    // ── Validation ────────────────────────────────────────────────────────
    if (!project_id) throw new AppError('project_id is required', 400)
    if (!visit_date) throw new AppError('visit_date is required (YYYY-MM-DD)', 400)
    if (!visit_time) throw new AppError('visit_time is required (HH:MM)', 400)

    const task = await getTaskOrFail(taskId)

    if (!task.lead_id) {
      throw new AppError('This follow-up is not linked to any lead and cannot be converted', 422)
    }

    if (task.is_completed) {
      throw new AppError('This follow-up is already completed', 422)
    }

    // Verify project exists
    const projectCheck = await pool.query(
      `SELECT id, name FROM projects WHERE id = $1`,
      [project_id]
    )
    if (!projectCheck.rows.length) throw new AppError('Project not found', 404)

    await client.query('BEGIN')

    // 1. Mark the follow-up task as completed
    await client.query(
      `UPDATE tasks
       SET is_completed = true,
           completed_at = NOW(),
           updated_at   = NOW()
       WHERE id = $1`,
      [taskId]
    )

    // 2. Create the site visit
    const svResult = await client.query(
      `INSERT INTO site_visits
         (lead_id, project_id, visit_date, visit_time, assigned_to,
          status, transport_arranged, notes)
       VALUES ($1, $2, $3, $4, $5, 'scheduled', $6, $7)
       RETURNING *`,
      [
        task.lead_id,
        project_id,
        visit_date,
        visit_time,
        assigned_to || task.assigned_to || task.lead_assigned_to,
        Boolean(transport_arranged),
        notes || null,
      ]
    )
    const sv = svResult.rows[0]

    // 3. Update lead status to site_visit_scheduled
    const lead = await pool.query(
      `SELECT status FROM leads WHERE id = $1`,
      [task.lead_id]
    )
    const currentLeadStatus = lead.rows[0]?.status
    const UPGRADEABLE = ['new','contacted','interested','follow_up']
    if (UPGRADEABLE.includes(currentLeadStatus)) {
      await client.query(
        `UPDATE leads
         SET status     = 'site_visit_scheduled',
             project_id = COALESCE($2, project_id),
             updated_at = NOW()
         WHERE id = $1`,
        [task.lead_id, project_id]
      )
    }

    // 4. Log activity on the lead
    const proj = projectCheck.rows[0]
    await logActivity(
      client,
      task.lead_id,
      'status_change',
      `Follow-up "${task.title}" converted to site visit at ${proj.name} on ${visit_date} at ${visit_time}`,
      req.user.id
    )

    await client.query('COMMIT')

    return sendSuccess(res, 'Follow-up converted to site visit successfully', {
      conversion: {
        type:             'follow_up_to_site_visit',
        task_id:          taskId,
        task_title:       task.title,
        task_completed:   true,
        lead_id:          task.lead_id,
        lead_name:        task.lead_name,
        lead_status_updated_to: UPGRADEABLE.includes(currentLeadStatus)
          ? 'site_visit_scheduled'
          : currentLeadStatus,
      },
      site_visit: {
        id:                 sv.id,
        lead_id:            sv.lead_id,
        project_id:         sv.project_id,
        project_name:       proj.name,
        visit_date:         sv.visit_date,
        visit_time:         sv.visit_time,
        status:             sv.status,
        assigned_to:        sv.assigned_to,
        transport_arranged: sv.transport_arranged,
        notes:              sv.notes,
        created_at:         sv.created_at,
      },
    }, 201)
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
}

module.exports = {
  getLeadConversionOptions,
  getFollowUpConversionOptions,
  convertLeadToFollowUp,
  convertLeadToSiteVisit,
  convertFollowUpToSiteVisit,
}
