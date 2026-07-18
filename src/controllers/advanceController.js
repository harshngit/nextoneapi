/**
 * advanceController.js — Nextone Reality
 * Employee advance payment tracking. Admin/Super Admin manage records for
 * anyone; every user can view only their own.
 */

const { pool } = require('../config/db');
const { sendSuccess, paginate } = require('../utils/response');
const AppError = require('../utils/AppError');
const { createNotification } = require('./notificationController');

const parseRow = (r) => ({
  ...r,
  amount: r.amount !== null ? parseFloat(r.amount) : null,
});

// ─── POST /api/v1/salary/advance (Admin/Super Admin) ───────────────────────────
const addAdvance = async (req, res, next) => {
  try {
    const { user_id, advance_date, amount, transaction_reference, payment_proof_url, notes } = req.body;

    if (!user_id || !advance_date || !amount) {
      return next(new AppError('user_id, advance_date and amount are required', 400));
    }
    if (parseFloat(amount) <= 0) {
      return next(new AppError('amount must be greater than 0', 400));
    }

    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1 AND is_active = true', [user_id]);
    if (!userCheck.rows.length) return next(new AppError('User not found', 404));

    const result = await pool.query(
      `INSERT INTO employee_advances
         (user_id, advance_date, amount, transaction_reference, payment_proof_url, notes, given_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [user_id, advance_date, amount, transaction_reference || null, payment_proof_url || null, notes || null, req.user.id]
    );

    const advance = result.rows[0];

    // Push notification to the employee who received it — not the admin who created it.
    createNotification(user_id, {
      type: 'payment_received',
      title: 'Advance Payment Recorded',
      message: `An advance payment of ₹${advance.amount} has been recorded for you (dated ${advance_date}).`,
      reference_id: advance.id,
      reference_type: 'advance',
      metadata: { advance_id: advance.id, amount: advance.amount },
    }).catch(() => {});

    return sendSuccess(res, 'Advance payment recorded successfully', parseRow(advance), 201);
  } catch (err) {
    next(err);
  }
};

const ADVANCE_SELECT = `
  SELECT a.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
  FROM employee_advances a
  LEFT JOIN users u ON u.id = a.user_id
`;

// ─── GET /api/v1/salary/advances (Admin/Super Admin — everyone's) ─────────────
const getAllAdvances = async (req, res, next) => {
  try {
    const { user_id, from, to, page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    let conditions = [];
    let params = [];
    let idx = 1;

    if (user_id) { conditions.push(`a.user_id = $${idx++}`); params.push(user_id); }
    if (from) { conditions.push(`a.advance_date >= $${idx++}`); params.push(from); }
    if (to)   { conditions.push(`a.advance_date <= $${idx++}`); params.push(to); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM employee_advances a ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `${ADVANCE_SELECT} ${where} ORDER BY a.advance_date DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(per_page), offset]
    );

    return res.json(paginate(dataResult.rows.map(parseRow), total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/v1/salary/advances/user/:user_id (Admin/Super Admin) ────────────
const getUserAdvances = async (req, res, next) => {
  try {
    const { user_id } = req.params;
    const { page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    const countResult = await pool.query('SELECT COUNT(*) FROM employee_advances WHERE user_id = $1', [user_id]);
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `${ADVANCE_SELECT} WHERE a.user_id = $1 ORDER BY a.advance_date DESC LIMIT $2 OFFSET $3`,
      [user_id, parseInt(per_page), offset]
    );

    return res.json(paginate(dataResult.rows.map(parseRow), total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/v1/salary/my-advances (self only) ────────────────────────────────
const getMyAdvances = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, per_page = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(per_page);

    const countResult = await pool.query('SELECT COUNT(*) FROM employee_advances WHERE user_id = $1', [userId]);
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `${ADVANCE_SELECT} WHERE a.user_id = $1 ORDER BY a.advance_date DESC LIMIT $2 OFFSET $3`,
      [userId, parseInt(per_page), offset]
    );

    return res.json(paginate(dataResult.rows.map(parseRow), total, parseInt(page), parseInt(per_page)));
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/v1/salary/advance/:id (Admin/Super Admin) ────────────────────
const deleteAdvance = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT id FROM employee_advances WHERE id = $1', [id]);
    if (!existing.rows.length) return next(new AppError('Advance payment record not found', 404));

    await pool.query('DELETE FROM employee_advances WHERE id = $1', [id]);
    return sendSuccess(res, 'Advance payment record deleted');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  addAdvance,
  getAllAdvances,
  getUserAdvances,
  getMyAdvances,
  deleteAdvance,
};
