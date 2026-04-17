const { pool } = require("../config/db");
const { sendSuccess, sendError } = require("../utils/response");

// Get All Users
const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, role, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let conditions = [];
    let params = [];
    let idx = 1;
    if (role) { conditions.push(`role = $${idx}`); params.push(role); idx++; }
    if (search) {
      conditions.push(`(first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR email ILIKE $${idx})`);
      params.push(`%${search}%`); idx++;
    }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const countResult = await pool.query(`SELECT COUNT(*) FROM users ${where}`, params);
    const total = parseInt(countResult.rows[0].count);
    params.push(parseInt(limit));
    params.push(offset);
    const result = await pool.query(
      `SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );
    return sendSuccess(res, {
      users: result.rows,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) },
    }, "Users fetched successfully");
  } catch (err) {
    console.error("GetAllUsers error:", err);
    return sendError(res, "Failed to fetch users", 500);
  }
};

// Get User By ID
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [id]
    );
    if (result.rows.length === 0) return sendError(res, "User not found", 404);
    return sendSuccess(res, { user: result.rows[0] }, "User fetched successfully");
  } catch (err) {
    console.error("GetUserById error:", err);
    return sendError(res, "Failed to fetch user", 500);
  }
};

// Update User
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, phone_number, language_preferences, regions } = req.body;
    const existing = await pool.query("SELECT id FROM users WHERE id = $1", [id]);
    if (existing.rows.length === 0) return sendError(res, "User not found", 404);
    const fields = [];
    const params = [];
    let idx = 1;
    if (first_name !== undefined) { fields.push(`first_name = $${idx}`); params.push(first_name); idx++; }
    if (last_name !== undefined) { fields.push(`last_name = $${idx}`); params.push(last_name); idx++; }
    if (phone_number !== undefined) { fields.push(`phone_number = $${idx}`); params.push(phone_number); idx++; }
    if (language_preferences !== undefined) { fields.push(`language_preferences = $${idx}`); params.push(language_preferences); idx++; }
    if (regions !== undefined) { fields.push(`regions = $${idx}`); params.push(regions); idx++; }
    if (fields.length === 0) return sendError(res, "No fields to update", 400);
    params.push(id);
    const result = await pool.query(
      `UPDATE users SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
      params
    );
    return sendSuccess(res, { user: result.rows[0] }, "User updated successfully");
  } catch (err) {
    console.error("UpdateUser error:", err);
    return sendError(res, "Failed to update user", 500);
  }
};

// Delete User
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT id FROM users WHERE id = $1", [id]);
    if (result.rows.length === 0) return sendError(res, "User not found", 404);
    await pool.query("UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1", [id]);
    return sendSuccess(res, {}, "User deleted successfully");
  } catch (err) {
    console.error("DeleteUser error:", err);
    return sendError(res, "Failed to delete user", 500);
  }
};

module.exports = { getAllUsers, getUserById, updateUser, deleteUser };
