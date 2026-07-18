/**
 * commissionController.js — Nextone Reality
 * Employee commission tracking, linked to a lead + project. Admin/Super
 * Admin manage records for anyone; every user can view only their own.
 */

const { pool } = require('../config/db');
const { sendSuccess, paginate } = require('../utils/response');
const AppError = require('../utils/AppError');
const { resolveProjectId, resolveProjectName } = require('../utils/projectResolver');

const parseRow = (r) => ({
  ...r,
  commission_amount: r.commission_amount !== null ? parseFloat(r.commission_amount) : null,
  commission_percentage: r.commission_percentage !== null ? parseFloat(r.commission_percentage) : null,
});

// ─── POST /api/v1/salary/commission (Admin/Super Admin) ───────────────────────
const addCommission = async (req, res, next) => {
  try {
    const { user_id, lead_id, project_id, project_name, commission_amount, commission_percentage, notes } = req.body;

    if (!user_id || !lead_id) {
      return next(new AppError('user_id and lead_id are required', 400));
    }
    if (commission_amount === undefined && commission_percentage === undefined) {
      return next(new AppError('Provide commission_amount and/or commission_percentage', 400));
    }

    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1 AND is_active = true', [user_id]);
    if (!userCheck.rows.length) return next(new AppError('User not found', 404));

    const leadCheck = await pool.query('SELECT id FROM leads WHERE id = $1', [lead_id]);
    if (!leadCheck.rows.length) return next(new AppError('Lead not found', 404));

    let resolvedProjectId = null;
    let resolvedProjectNameText = null;
    if (project_id) {
      try {
        resolvedProjectId = await resolveProjectId(project_id);
      } catch (e) {
        resolvedProjectNameText = String(project_id).trim();
      }
    } else if (project_name) {
      const resolved = await resolveProjectName(project_name);
      resolvedProjectId = resolved.projectId;
      resolvedProjectNameText = resolved.projectNameText;
    }

    const result = await pool.query(
      `INSERT INTO employee_commissions
         (user_id, lead_id, project_id, project_name_text, commission_amount, commission_percentage, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        user_id, lead_id, resolvedProjectId, resolvedProjectNameText,
        commission_amount ?? null, commission_percentage ?? null, notes || null, req.user.id,
      ]
    );

    return sendSuccess(res, 'Commission recorded successfully', parseRow(result.rows[0]), 201);
  } catch (err) {
    next(err);
  }
};

const COMMISSION_SELECT = `
  SELECT c.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name,
         l.name AS lead_name, l.phone AS lead_phone,
         COALESCE(p.name, c.project_name_text) AS project_name
  FROM employee_commissions c
  LEFT JOIN users u ON u.id = c.user_id
  LEFT JOIN leads l ON l.id = c.lead_id
  LEFT JOIN projects p ON p.id = c.project_id
`;

// ─── GET /api/v1/salary/commissions (Admin/Super Admin — everyone's) ──────────
const getAllCommissions = async (req, res, next) => {
  try {
    const { user_id, paid, from, to, page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = [];
    let params = [];
    let idx = 1;

    if (user_id) { conditions.push(`c.user_id = $${idx++}`); params.push(user_id); }
    if (paid !== undefined) { conditions.push(`c.paid = $${idx++}`); params.push(paid === 'true'); }
    if (from) { conditions.push(`c.created_at::date >= $${idx++}`); params.push(from); }
    if (to)   { conditions.push(`c.created_at::date <= $${idx++}`); params.push(to); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM employee_commissions c ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `${COMMISSION_SELECT} ${where} ORDER BY c.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json(paginate(dataResult.rows.map(parseRow), total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/v1/salary/commissions/user/:user_id (Admin/Super Admin) ─────────
const getUserCommissions = async (req, res, next) => {
  try {
    const { user_id } = req.params;
    const { page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    const countResult = await pool.query('SELECT COUNT(*) FROM employee_commissions WHERE user_id = $1', [user_id]);
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `${COMMISSION_SELECT} WHERE c.user_id = $1 ORDER BY c.created_at DESC LIMIT $2 OFFSET $3`,
      [user_id, parseInt(per_page), offset]
    );

    return res.json(paginate(dataResult.rows.map(parseRow), total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/v1/salary/my-commissions (self only) ─────────────────────────────
const getMyCommissions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    const countResult = await pool.query('SELECT COUNT(*) FROM employee_commissions WHERE user_id = $1', [userId]);
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `${COMMISSION_SELECT} WHERE c.user_id = $1 ORDER BY c.created_at DESC LIMIT $2 OFFSET $3`,
      [userId, parseInt(per_page), offset]
    );

    return res.json(paginate(dataResult.rows.map(parseRow), total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/v1/salary/commission/:id/paid (Admin/Super Admin) ─────────────
const markCommissionPaid = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT id FROM employee_commissions WHERE id = $1', [id]);
    if (!existing.rows.length) return next(new AppError('Commission record not found', 404));

    const result = await pool.query(
      `UPDATE employee_commissions SET paid = true, paid_date = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    return sendSuccess(res, 'Commission marked as paid', parseRow(result.rows[0]));
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/v1/salary/commission/:id (Admin/Super Admin) ────────────────
const deleteCommission = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT id FROM employee_commissions WHERE id = $1', [id]);
    if (!existing.rows.length) return next(new AppError('Commission record not found', 404));

    await pool.query('DELETE FROM employee_commissions WHERE id = $1', [id]);
    return sendSuccess(res, 'Commission record deleted');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  addCommission,
  getAllCommissions,
  getUserCommissions,
  getMyCommissions,
  markCommissionPaid,
  deleteCommission,
};
