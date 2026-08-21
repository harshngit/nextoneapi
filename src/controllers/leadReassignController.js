/**
 * leadReassignController.js — Nextone Reality
 * Lead reassignment operations:
 *  1. Reassign single lead to a new user (with optional status change)
 *  2. Bulk reassign multiple leads to a new user (with optional status change)
 *  3. Get reassignment history for a lead
 */

const { pool } = require('../config/db');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const emailService = require('../utils/emailService');
const { createNotification, notifyAdmins } = require('./notificationController');

const VALID_STATUSES = [
  "new", "contacted", "interested", "follow_up",
  "site_visit_scheduled", "site_visit_done",
  "negotiation", "booked", "lost",
];

const isValidLeadStatus = async (status) => {
  if (VALID_STATUSES.includes(status)) return true;
  const custom = await pool.query(
    'SELECT key FROM lead_statuses WHERE key = $1 AND is_active = true', [status]
  );
  return custom.rows.length > 0;
};

/**
 * PATCH /api/v1/leads/:id/reassign
 * Reassign a single lead to a new user (with optional status change)
 */
const reassignLead = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id: leadId } = req.params;
    const { assigned_to, reason, status } = req.body;
    const { id: performedBy, role } = req.user;

    // Validation
    if (!assigned_to) {
      return next(new AppError('assigned_to (new user ID) is required', 400));
    }

    // Validate status if provided
    const hasStatus = status !== undefined && status !== null && status !== '';
    if (hasStatus && !(await isValidLeadStatus(status))) {
      return next(new AppError(
        `Invalid status '${status}'. Use GET /api/v1/config/lead-statuses for the full list.`, 400
      ));
    }

    await client.query('BEGIN');

    // Check if lead exists and get current assignment + status
    const leadCheck = await client.query(
      `SELECT l.id, l.name, l.phone, l.email, l.assigned_to, l.project_id, l.status,
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
    const leadOldStatus = lead.status;
    const isStatusChanging = hasStatus && status !== leadOldStatus;
    const isAssigneeChanging = oldAssignedTo !== assigned_to;

    // Need at least one change (either different assignee OR status change)
    if (!isAssigneeChanging && !isStatusChanging) {
      await client.query('ROLLBACK');
      return next(new AppError('Lead is already assigned to this user and status is unchanged', 400));
    }

    // Verify new assignee exists and is active (only if we're actually changing assignee)
    if (isAssigneeChanging) {
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
    }

    // Always fetch newAssignee data (even if same) for consistency
    const newAssigneeResult = await client.query(
      `SELECT id, first_name, last_name, email, role
       FROM users
       WHERE id = $1 AND is_active = true`,
      [assigned_to]
    );
    if (newAssigneeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return next(new AppError('Assignee not found or inactive', 404));
    }
    const newAssignee = newAssigneeResult.rows[0];

    // Permission check — all hierarchy roles (rank 1–8) can reassign
    const REASSIGN_DENIED = ['external_caller', 'hr_admin', 'digital_marketing'];
    if (REASSIGN_DENIED.includes(role)) {
      await client.query('ROLLBACK');
      return next(new AppError('Access denied. You do not have permission to reassign leads', 403));
    }

    // Non-admin roles can only reassign within their team
    if (!['admin', 'super_admin'].includes(role)) {
      const { getTeamIds } = require('../utils/teamUtils');
      const teamIds = await getTeamIds(performedBy);
      if (!teamIds.includes(assigned_to)) {
        await client.query('ROLLBACK');
        return next(new AppError('You can only reassign leads to members within your team', 403));
      }
    }

    // Build dynamic update
    const setClauses = ['updated_at = NOW()'];
    const params = [];
    let pIdx = 0;

    if (isAssigneeChanging) {
      pIdx++;
      setClauses.push(`assigned_to = $${pIdx}`);
      params.push(assigned_to);
    }

    if (isStatusChanging) {
      pIdx++;
      setClauses.push(`status = $${pIdx}`);
      params.push(status);
    }

    pIdx++;
    params.push(leadId);

    await client.query(
      `UPDATE leads SET ${setClauses.join(', ')} WHERE id = $${pIdx}`,
      params
    );

    // Log activity - reassignment
    let activityParts = [];
    if (isAssigneeChanging) {
      activityParts.push(`Lead reassigned from ${lead.current_assignee_name || 'Unassigned'} to ${newAssignee.first_name} ${newAssignee.last_name}`);
    }
    if (isStatusChanging) {
      activityParts.push(`Status changed from ${leadOldStatus} to ${status}`);
    }
    if (reason) {
      activityParts.push(`Reason: ${reason}`);
    }
    const activityNote = activityParts.join('. ');

    await client.query(
      `INSERT INTO lead_activities (lead_id, type, note, performed_by)
       VALUES ($1, $2, $3, $4)`,
      [leadId, 'assignment', activityNote, performedBy]
    );

    // Log status change separately if status was changed
    if (isStatusChanging) {
      await client.query(
        `INSERT INTO lead_activities (lead_id, type, note, performed_by)
         VALUES ($1, $2, $3, $4)`,
        [leadId, 'status_change', `Status changed from ${leadOldStatus} to ${status}${reason ? `. Reason: ${reason}` : ''}`, performedBy]
      );

      // Sync site_visits row for target counting
      if (status === 'site_visit_done') {
        await client.query(
          `UPDATE site_visits
           SET status = 'done', updated_at = NOW()
           WHERE id = (
             SELECT id FROM site_visits
             WHERE lead_id = $1 AND status IN ('scheduled', 'rescheduled')
             ORDER BY visit_date DESC, created_at DESC
             LIMIT 1
           )`,
          [leadId]
        );
      }
    }

    // Create reassignment history (only if we actually changed the assignee)
    if (isAssigneeChanging) {
      await client.query(
        `INSERT INTO lead_reassignment_history
          (lead_id, from_user_id, to_user_id, reason, performed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [leadId, oldAssignedTo, assigned_to, reason || null, performedBy]
      );
    }

    await client.query('COMMIT');

    // Get performer details for email
    const performerDetails = await pool.query(
      'SELECT first_name, last_name FROM users WHERE id = $1',
      [performedBy]
    );
    const performerName = performerDetails.rows[0]
      ? `${performerDetails.rows[0].first_name} ${performerDetails.rows[0].last_name}`
      : 'System';

    // ── Push + in-app + email (all fire-and-forget) ───────────────────────────
    setImmediate(async () => {
      try {
        const newAssigneeName = `${newAssignee.first_name} ${newAssignee.last_name}`;

        if (isAssigneeChanging) {
          // Push: notify NEW assignee
          await createNotification(newAssignee.id, {
            type:           'lead_assigned',
            title:          'Lead Assigned to You',
            message:        isStatusChanging
              ? `Lead "${lead.name}" has been assigned to you by ${performerName}. Status changed to ${status}`
              : `Lead "${lead.name}" has been assigned to you by ${performerName}`,
            reference_id:   leadId,
            reference_type: 'lead',
            metadata:       { lead_id: leadId, reason: reason || null, new_status: isStatusChanging ? status : null },
          });

          // Push: notify OLD assignee (if existed)
          if (oldAssignedTo) {
            await createNotification(oldAssignedTo, {
              type:           'lead_assigned',
              title:          'Lead Reassigned Away',
              message:        `Lead "${lead.name}" has been reassigned to ${newAssigneeName}`,
              reference_id:   leadId,
              reference_type: 'lead',
              metadata:       { lead_id: leadId, reason: reason || null },
            });
          }

          // Push: notify manager of new assignee
          const mgrRow = await pool.query(
            `SELECT manager_id FROM users WHERE id = $1 AND manager_id IS NOT NULL`, [newAssignee.id]
          );
          if (mgrRow.rows.length) {
            await createNotification(mgrRow.rows[0].manager_id, {
              type:           'lead_assigned',
              title:          'Lead Assigned to Your Team',
              message:        `Lead "${lead.name}" was assigned to ${newAssigneeName}`,
              reference_id:   leadId,
              reference_type: 'lead',
              metadata:       { lead_id: leadId },
            });
          }

          // Emails
          if (newAssignee.email) {
            await emailService.notifyLeadAssigned({
              lead: { id: lead.id, name: lead.name, phone: lead.phone, email: lead.email, project_name: lead.project_name },
              assigneeName: newAssigneeName,
              assignerName: performerName,
              assigneeEmail: newAssignee.email,
              note: reason || (isStatusChanging
                ? `This lead has been reassigned to you. Status: ${status}.`
                : 'This lead has been reassigned to you.'),
            });
          }
          if (oldAssignedTo && lead.current_assignee_email) {
            await emailService.notifyLeadReassigned({
              lead: { id: lead.id, name: lead.name, phone: lead.phone },
              oldAssigneeName: lead.current_assignee_name,
              oldAssigneeEmail: lead.current_assignee_email,
              newAssigneeName,
              performedBy: performerName,
              reason: reason || null,
            });
          }
        }

        if (isStatusChanging) {
          const isBooked = status === 'booked';

          // Status-change notification to the (now-current) assignee
          if (newAssignee.id) {
            await createNotification(newAssignee.id, {
              type:           'lead_status_changed',
              title:          isBooked ? '🎉 Lead Booked!' : 'Lead Status Updated',
              message:        `Lead "${lead.name}" status changed from ${leadOldStatus} to ${status}`,
              reference_id:   leadId,
              reference_type: 'lead',
              metadata:       { old_status: leadOldStatus, new_status: status, reason: reason || null },
            });
          }
        }

        // Push: notify admins (always — even for status-only change)
        await notifyAdmins({
          type:           'lead_assigned',
          title:          isStatusChanging && isAssigneeChanging
            ? 'Lead Reassigned + Status Changed'
            : isAssigneeChanging
              ? 'Lead Reassigned'
              : 'Lead Status Changed via Reassign',
          message:        isStatusChanging && isAssigneeChanging
            ? `Lead "${lead.name}" was reassigned to ${newAssigneeName} by ${performerName}. Status changed to ${status}`
            : isAssigneeChanging
              ? `Lead "${lead.name}" was reassigned to ${newAssigneeName} by ${performerName}`
              : `Lead "${lead.name}" status changed to ${status} by ${performerName} (via reassign)`,
          reference_id:   leadId,
          reference_type: 'lead',
          metadata:       { lead_id: leadId, reason: reason || null, new_status: isStatusChanging ? status : null },
        });
      } catch (err) {
        console.error('[Notification/Email] Reassignment failed:', err.message);
      }
    });

    return sendSuccess(res, 'Lead reassigned successfully', {
      leadId,
      leadName: lead.name,
      oldAssignee: isAssigneeChanging && oldAssignedTo ? {
        id: oldAssignedTo,
        name: lead.current_assignee_name,
      } : null,
      newAssignee: {
        id: newAssignee.id,
        name: `${newAssignee.first_name} ${newAssignee.last_name}`,
        email: newAssignee.email,
      },
      statusChanged: isStatusChanging,
      oldStatus: isStatusChanging ? leadOldStatus : null,
      newStatus: isStatusChanging ? status : null,
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
 * Bulk reassign multiple leads to a new user (with optional status change)
 */
const bulkReassignLeads = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { lead_ids, assigned_to, reason, status } = req.body;
    const { id: performedBy, role } = req.user;

    // Validation
    if (!lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0) {
      return next(new AppError('lead_ids array is required and must not be empty', 400));
    }

    if (!assigned_to) {
      return next(new AppError('assigned_to (new user ID) is required', 400));
    }

    // Validate status if provided
    const hasStatus = status !== undefined && status !== null && status !== '';
    if (hasStatus && !(await isValidLeadStatus(status))) {
      return next(new AppError(
        `Invalid status '${status}'. Use GET /api/v1/config/lead-statuses for the full list.`, 400
      ));
    }

    // Permission check — all hierarchy roles (rank 1–8) can reassign
    const REASSIGN_DENIED = ['external_caller', 'hr_admin', 'digital_marketing'];
    if (REASSIGN_DENIED.includes(role)) {
      return next(new AppError('Access denied. You do not have permission to reassign leads', 403));
    }

    await client.query('BEGIN');

    // Non-admin roles can only reassign within their team
    if (!['admin', 'super_admin'].includes(role)) {
      const { getTeamIds } = require('../utils/teamUtils');
      const teamIds = await getTeamIds(req.user.id);
      if (!teamIds.includes(assigned_to)) {
        await client.query('ROLLBACK');
        return next(new AppError('You can only reassign leads to members within your team', 403));
      }
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

    // Get all valid leads (include current status)
    const leadsCheck = await client.query(
      `SELECT l.id, l.name, l.assigned_to, l.status,
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
    const statusChangedCount = { total: 0, leads: [] };

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
      const isAssigneeChanging = lead.assigned_to !== assigned_to;
      const isStatusChanging = hasStatus && status !== lead.status;
      const hasAnyChange = isAssigneeChanging || isStatusChanging;

      // Skip if nothing changed
      if (!hasAnyChange) {
        skipped.push({
          leadId: lead.id,
          leadName: lead.name,
          reason: 'Already assigned to this user and status is unchanged',
        });
        continue;
      }

      // Build dynamic update
      const setClauses = ['updated_at = NOW()'];
      const params = [];
      let pIdx = 0;

      if (isAssigneeChanging) {
        pIdx++;
        setClauses.push(`assigned_to = $${pIdx}`);
        params.push(assigned_to);
      }

      if (isStatusChanging) {
        pIdx++;
        setClauses.push(`status = $${pIdx}`);
        params.push(status);
      }

      pIdx++;
      params.push(lead.id);

      await client.query(
        `UPDATE leads SET ${setClauses.join(', ')} WHERE id = $${pIdx}`,
        params
      );

      // Log activity
      let activityParts = [];
      if (isAssigneeChanging) {
        activityParts.push(`Lead reassigned from ${lead.current_assignee_name || 'Unassigned'} to ${newAssignee.first_name} ${newAssignee.last_name}`);
      }
      if (isStatusChanging) {
        activityParts.push(`Status changed from ${lead.status} to ${status}`);
      }
      if (reason) {
        activityParts.push(`Reason: ${reason}`);
      }
      const activityNote = activityParts.join('. ');

      await client.query(
        `INSERT INTO lead_activities (lead_id, type, note, performed_by)
         VALUES ($1, $2, $3, $4)`,
        [lead.id, 'assignment', activityNote, performedBy]
      );

      // Log status change separately if changed
      if (isStatusChanging) {
        await client.query(
          `INSERT INTO lead_activities (lead_id, type, note, performed_by)
           VALUES ($1, $2, $3, $4)`,
          [lead.id, 'status_change', `Status changed from ${lead.status} to ${status}${reason ? `. Reason: ${reason}` : ''}`, performedBy]
        );

        // Sync site_visits if applicable
        if (status === 'site_visit_done') {
          await client.query(
            `UPDATE site_visits
             SET status = 'done', updated_at = NOW()
             WHERE id = (
               SELECT id FROM site_visits
               WHERE lead_id = $1 AND status IN ('scheduled', 'rescheduled')
               ORDER BY visit_date DESC, created_at DESC
               LIMIT 1
             )`,
            [lead.id]
          );
        }

        statusChangedCount.total++;
        statusChangedCount.leads.push({ leadId: lead.id, leadName: lead.name, oldStatus: lead.status, newStatus: status });
      }

      // Create reassignment history (only if assignee actually changed)
      if (isAssigneeChanging) {
        await client.query(
          `INSERT INTO lead_reassignment_history
            (lead_id, from_user_id, to_user_id, reason, performed_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [lead.id, lead.assigned_to, assigned_to, reason || null, performedBy]
        );
      }

      successfulReassignments.push({
        leadId: lead.id,
        leadName: lead.name,
        oldAssignee: lead.current_assignee_name || 'Unassigned',
        statusChanged: isStatusChanging,
        oldStatus: isStatusChanging ? lead.status : null,
        newStatus: isStatusChanging ? status : null,
      });
    }

    await client.query('COMMIT');

    // Send push + email notification asynchronously
    setImmediate(async () => {
      try {
        if (successfulReassignments.length === 0) return;
        const newAssigneeName = `${newAssignee.first_name} ${newAssignee.last_name}`;
        const count = successfulReassignments.length;
        const statusCount = statusChangedCount.total;

        // Push: notify new assignee (single combined notification)
        await createNotification(newAssignee.id, {
          type:           'lead_assigned',
          title:          `${count} Lead${count > 1 ? 's' : ''} Assigned to You`,
          message:        statusCount > 0
            ? `${count} lead${count > 1 ? 's have' : ' has'} been assigned to you by ${performerName}. ${statusCount} status${statusCount > 1 ? 'es' : ''} updated.`
            : `${count} lead${count > 1 ? 's have' : ' has'} been assigned to you by ${performerName}`,
          reference_id:   null,
          reference_type: 'lead',
          metadata:       {
            lead_ids: successfulReassignments.map(r => r.leadId),
            count,
            reason: reason || null,
            new_status: hasStatus ? status : null,
            status_changed_count: statusCount,
          },
        });

        // Push: notify manager of new assignee
        const mgrRow = await pool.query(
          `SELECT manager_id FROM users WHERE id = $1 AND manager_id IS NOT NULL`, [newAssignee.id]
        );
        if (mgrRow.rows.length) {
          await createNotification(mgrRow.rows[0].manager_id, {
            type:           'lead_assigned',
            title:          `${count} Lead${count > 1 ? 's' : ''} Assigned to Your Team`,
            message:        `${count} lead${count > 1 ? 's were' : ' was'} bulk-assigned to ${newAssigneeName}`,
            reference_id:   null,
            reference_type: 'lead',
            metadata:       { count, assigned_to: newAssignee.id, new_status: hasStatus ? status : null },
          });
        }

        // Push: notify admins
        await notifyAdmins({
          type:           'lead_assigned',
          title:          'Bulk Lead Reassignment' + (statusCount > 0 ? ' + Status Changes' : ''),
          message:        statusCount > 0
            ? `${count} lead${count > 1 ? 's were' : ' was'} bulk-assigned to ${newAssigneeName} by ${performerName}. ${statusCount} status${statusCount > 1 ? 'es' : ''} changed to ${status}.`
            : `${count} lead${count > 1 ? 's were' : ' was'} bulk-assigned to ${newAssigneeName} by ${performerName}`,
          reference_id:   null,
          reference_type: 'lead',
          metadata:       {
            count,
            assigned_to: newAssignee.id,
            reason: reason || null,
            new_status: hasStatus ? status : null,
            status_changed_count: statusCount,
          },
        });

        // NOTE: bulk email intentionally removed
      } catch (err) {
        console.error('[Notification/Email] Bulk reassignment failed:', err.message);
      }
    });

    return sendSuccess(res, 'Bulk reassignment completed', {
      totalRequested: lead_ids.length,
      successful: successfulReassignments.length,
      skipped: skipped.length,
      statusChanged: statusChangedCount.total,
      newStatus: hasStatus ? status : null,
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
