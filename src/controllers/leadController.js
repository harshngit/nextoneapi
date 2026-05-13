/**
 * leadReassignController.js — Nextone Reality
 * Lead reassignment operations:
 *  1. Reassign single lead to a new user
 *  2. Bulk reassign multiple leads to a new user
 *  3. Get reassignment history for a lead
 */

const { pool } = require('../config/db');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const emailService = require('../utils/emailService');

/**
 * PATCH /api/v1/leads/:id/reassign
 * Reassign a single lead to a new user
 */
const reassignLead = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id: leadId } = req.params;
    const { assigned_to, reason } = req.body;
    const { id: performedBy, role } = req.user;

    // Validation
    if (!assigned_to) {
      return next(new AppError('assigned_to (new user ID) is required', 400));
    }

    await client.query('BEGIN');

    // Check if lead exists and get current assignment
    const leadCheck = await client.query(
      `SELECT l.id, l.name, l.phone, l.email, l.assigned_to, l.project_id,
              p.name AS project_name,
              CONCAT(u.first_name, ' ', u.last_name) AS current_assignee_name,
              u.email AS current_assignee_email
       FROM leads l
       LEFT JOIN projects p ON p.id = l.project_id
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE l.id = $1 AND l.is_archived = false`,
      [leadId]
    );

    if (leadCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return next(new AppError('Lead not found', 404));
    }

    const lead = leadCheck.rows[0];
    const oldAssignedTo = lead.assigned_to;

    // Check if trying to reassign to the same person
    if (oldAssignedTo === assigned_to) {
      await client.query('ROLLBACK');
      return next(new AppError('Lead is already assigned to this user', 400));
    }

    // Verify new assignee exists and is active
    const newAssigneeCheck = await client.query(
      `SELECT id, first_name, last_name, email, role 
       FROM users 
       WHERE id = $1 AND is_active = true`,
      [assigned_to]
    );

    if (newAssigneeCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return next(new AppError('New assignee not found or inactive', 404));
    }

    const newAssignee = newAssigneeCheck.rows[0];

    // Permission check - only admins, super_admins, and sales_managers can reassign
    if (!['admin', 'super_admin', 'sales_manager'].includes(role)) {
      await client.query('ROLLBACK');
      return next(new AppError('Access denied. Only admins and managers can reassign leads', 403));
    }

    // Update lead assignment
    await client.query(
      `UPDATE leads 
       SET assigned_to = $1, updated_at = NOW() 
       WHERE id = $2`,
      [assigned_to, leadId]
    );

    // Log activity - create reassignment record
    const activityNote = reason 
      ? `Lead reassigned from ${lead.current_assignee_name || 'Unassigned'} to ${newAssignee.first_name} ${newAssignee.last_name}. Reason: ${reason}`
      : `Lead reassigned from ${lead.current_assignee_name || 'Unassigned'} to ${newAssignee.first_name} ${newAssignee.last_name}`;

    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by)
       VALUES ($1, $2, $3, $4)`,
      [leadId, 'assignment', activityNote, performedBy]
    );

    // Create reassignment history record (if you want a dedicated table for this)
    await client.query(
      `INSERT INTO lead_reassignment_history 
        (lead_id, from_user_id, to_user_id, reason, performed_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [leadId, oldAssignedTo, assigned_to, reason || null, performedBy]
    );

    await client.query('COMMIT');

    // Get performer details for email
    const performerDetails = await pool.query(
      'SELECT first_name, last_name FROM users WHERE id = $1',
      [performedBy]
    );
    const performerName = performerDetails.rows[0]
      ? `${performerDetails.rows[0].first_name} ${performerDetails.rows[0].last_name}`
      : 'System';

    // Send email notifications asynchronously
    setImmediate(async () => {
      try {
        // Notify new assignee
        if (newAssignee.email) {
          await emailService.notifyLeadAssigned({
            lead: {
              id: lead.id,
              name: lead.name,
              phone: lead.phone,
              email: lead.email,
              project_name: lead.project_name,
            },
            assigneeName: `${newAssignee.first_name} ${newAssignee.last_name}`,
            assignerName: performerName,
            assigneeEmail: newAssignee.email,
            note: reason || 'This lead has been reassigned to you.',
          });
        }

        // Optionally notify old assignee about reassignment
        if (oldAssignedTo && lead.current_assignee_email) {
          await emailService.notifyLeadReassigned({
            lead: {
              id: lead.id,
              name: lead.name,
              phone: lead.phone,
            },
            oldAssigneeName: lead.current_assignee_name,
            oldAssigneeEmail: lead.current_assignee_email,
            newAssigneeName: `${newAssignee.first_name} ${newAssignee.last_name}`,
            performedBy: performerName,
            reason: reason || null,
          });
        }
      } catch (emailErr) {
        console.error('[Email] Reassignment notification failed:', emailErr.message);
      }
    });

    return sendSuccess(res, 'Lead reassigned successfully', {
      leadId,
      leadName: lead.name,
      oldAssignee: oldAssignedTo ? {
        id: oldAssignedTo,
        name: lead.current_assignee_name,
      } : null,
      newAssignee: {
        id: newAssignee.id,
        name: `${newAssignee.first_name} ${newAssignee.last_name}`,
        email: newAssignee.email,
      },
      reason: reason || null,
      performedBy: performerName,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

/**
 * POST /api/v1/leads/bulk-reassign
 * Bulk reassign multiple leads to a new user
 */
const bulkReassignLeads = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { lead_ids, assigned_to, reason } = req.body;
    const { id: performedBy, role } = req.user;

    // Validation
    if (!lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0) {
      return next(new AppError('lead_ids array is required and must not be empty', 400));
    }

    if (!assigned_to) {
      return next(new AppError('assigned_to (new user ID) is required', 400));
    }

    if (lead_ids.length > 100) {
      return next(new AppError('Cannot reassign more than 100 leads at once', 400));
    }

    // Permission check
    if (!['admin', 'super_admin', 'sales_manager'].includes(role)) {
      return next(new AppError('Access denied. Only admins and managers can reassign leads', 403));
    }

    await client.query('BEGIN');

    // Verify new assignee exists and is active
    const newAssigneeCheck = await client.query(
      `SELECT id, first_name, last_name, email, role 
       FROM users 
       WHERE id = $1 AND is_active = true`,
      [assigned_to]
    );

    if (newAssigneeCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return next(new AppError('New assignee not found or inactive', 404));
    }

    const newAssignee = newAssigneeCheck.rows[0];

    // Get all valid leads
    const leadsCheck = await client.query(
      `SELECT l.id, l.name, l.assigned_to,
              CONCAT(u.first_name, ' ', u.last_name) AS current_assignee_name
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE l.id = ANY($1::uuid[]) AND l.is_archived = false`,
      [lead_ids]
    );

    if (leadsCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return next(new AppError('No valid leads found', 404));
    }

    const validLeads = leadsCheck.rows;
    const successfulReassignments = [];
    const skipped = [];

    // Get performer name
    const performerDetails = await client.query(
      'SELECT first_name, last_name FROM users WHERE id = $1',
      [performedBy]
    );
    const performerName = performerDetails.rows[0]
      ? `${performerDetails.rows[0].first_name} ${performerDetails.rows[0].last_name}`
      : 'System';

    // Process each lead
    for (const lead of validLeads) {
      // Skip if already assigned to the target user
      if (lead.assigned_to === assigned_to) {
        skipped.push({
          leadId: lead.id,
          leadName: lead.name,
          reason: 'Already assigned to this user',
        });
        continue;
      }

      // Update assignment
      await client.query(
        `UPDATE leads 
         SET assigned_to = $1, updated_at = NOW() 
         WHERE id = $2`,
        [assigned_to, lead.id]
      );

      // Log activity
      const activityNote = reason
        ? `Lead reassigned from ${lead.current_assignee_name || 'Unassigned'} to ${newAssignee.first_name} ${newAssignee.last_name}. Reason: ${reason}`
        : `Lead reassigned from ${lead.current_assignee_name || 'Unassigned'} to ${newAssignee.first_name} ${newAssignee.last_name}`;

      await client.query(
        `INSERT INTO lead_activities (lead_id, type, note, performed_by)
         VALUES ($1, $2, $3, $4)`,
        [lead.id, 'assignment', activityNote, performedBy]
      );

      // Create reassignment history
      await client.query(
        `INSERT INTO lead_reassignment_history 
          (lead_id, from_user_id, to_user_id, reason, performed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [lead.id, lead.assigned_to, assigned_to, reason || null, performedBy]
      );

      successfulReassignments.push({
        leadId: lead.id,
        leadName: lead.name,
        oldAssignee: lead.current_assignee_name || 'Unassigned',
      });
    }

    await client.query('COMMIT');

    // Send email notification to new assignee asynchronously
    setImmediate(async () => {
      try {
        if (newAssignee.email && successfulReassignments.length > 0) {
          await emailService.notifyBulkLeadsAssigned({
            assigneeName: `${newAssignee.first_name} ${newAssignee.last_name}`,
            assigneeEmail: newAssignee.email,
            leadsCount: successfulReassignments.length,
            performedBy: performerName,
            reason: reason || null,
          });
        }
      } catch (emailErr) {
        console.error('[Email] Bulk reassignment notification failed:', emailErr.message);
      }
    });

    return sendSuccess(res, 'Bulk reassignment completed', {
      totalRequested: lead_ids.length,
      successful: successfulReassignments.length,
      skipped: skipped.length,
      newAssignee: {
        id: newAssignee.id,
        name: `${newAssignee.first_name} ${newAssignee.last_name}`,
        email: newAssignee.email,
      },
      successfulReassignments,
      skippedLeads: skipped,
      reason: reason || null,
      performedBy: performerName,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/leads/:id/reassignment-history
 * Get reassignment history for a specific lead
 */
const getReassignmentHistory = async (req, res, next) => {
  try {
    const { id: leadId } = req.params;
    const { page = 1, per_page = 20 } = req.query;
    const { role, id: callerId } = req.user;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    // Check lead exists and get basic info
    const leadCheck = await pool.query(
      `SELECT l.id, l.name, l.phone,
              CONCAT(u.first_name,' ',u.last_name) AS current_assignee_name,
              u.role AS current_assignee_role
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE l.id = $1`,
      [leadId]
    );

    if (leadCheck.rows.length === 0) {
      return next(new AppError('Lead not found', 404));
    }

    // Permission: sales_exec / external_caller can only see history for leads assigned to them
    if (['sales_executive', 'external_caller'].includes(role)) {
      const ownership = await pool.query(
        'SELECT id FROM leads WHERE id = $1 AND assigned_to = $2',
        [leadId, callerId]
      );
      if (ownership.rows.length === 0) {
        return next(new AppError('Access denied — this lead is not assigned to you', 403));
      }
    }

    // Total count for pagination
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM lead_reassignment_history WHERE lead_id = $1',
      [leadId]
    );
    const total = parseInt(countResult.rows[0].count);

    const history = await pool.query(
      `SELECT
         rh.id,
         rh.lead_id,
         rh.from_user_id,
         rh.to_user_id,
         rh.reason,
         rh.performed_by,
         rh.created_at,
         CONCAT(fu.first_name,' ',fu.last_name)  AS from_user_name,
         fu.role                                  AS from_user_role,
         CONCAT(tu.first_name,' ',tu.last_name)  AS to_user_name,
         tu.role                                  AS to_user_role,
         CONCAT(pb.first_name,' ',pb.last_name)  AS performed_by_name,
         pb.role                                  AS performed_by_role
       FROM lead_reassignment_history rh
       LEFT JOIN users fu ON fu.id = rh.from_user_id
       LEFT JOIN users tu ON tu.id = rh.to_user_id
       LEFT JOIN users pb ON pb.id = rh.performed_by
       WHERE rh.lead_id = $1
       ORDER BY rh.created_at DESC
       LIMIT $2 OFFSET $3`,
      [leadId, parseInt(per_page), offset]
    );

    const lead = leadCheck.rows[0];

    return sendSuccess(res, 'Reassignment history fetched successfully', {
      lead: {
        id:                    leadId,
        name:                  lead.name,
        phone:                 lead.phone,
        current_assignee_name: lead.current_assignee_name || 'Unassigned',
        current_assignee_role: lead.current_assignee_role || null,
      },
      total_reassignments: total,
      pagination: {
        total,
        page:        parseInt(page),
        per_page:    parseInt(per_page),
        total_pages: Math.ceil(total / parseInt(per_page)),
      },
      history: history.rows.map(h => ({
        id:   h.id,
        from: h.from_user_id ? {
          id:   h.from_user_id,
          name: h.from_user_name,
          role: h.from_user_role,
        } : null,
        to: {
          id:   h.to_user_id,
          name: h.to_user_name,
          role: h.to_user_role,
        },
        reason:      h.reason || null,
        performed_by: {
          id:   h.performed_by,
          name: h.performed_by_name,
          role: h.performed_by_role,
        },
        reassigned_at: h.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  reassignLead,
  bulkReassignLeads,
  getReassignmentHistory,
};