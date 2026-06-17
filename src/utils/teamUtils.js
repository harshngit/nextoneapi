const { pool } = require('../config/db');

// Roles that see EVERYTHING — no scoping
const ADMIN_ROLES = ['super_admin', 'admin'];

// Roles that see only their own assigned data
const LEAF_ROLES = ['sales_executive', 'external_caller', 'hr_admin', 'digital_marketing'];

// Roles in the middle — see their entire sub-tree recursively via manager_id chain:
// associate_partner / cluster_head / cluster / partner / team_leader / sales_manager
// (any role not in ADMIN_ROLES and not in LEAF_ROLES)

/**
 * Returns all user IDs in the sub-tree rooted at callerId (including callerId itself).
 * Uses a recursive CTE that follows manager_id links downward.
 *
 * associate_partner → partner → team_leader → sales_manager → sales_executive
 * All of these will be returned if they appear below callerId in the chain.
 */
const getTeamIds = async (callerId) => {
  const result = await pool.query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM users WHERE id = $1
       UNION ALL
       SELECT u.id FROM users u
       INNER JOIN sub s ON u.manager_id = s.id
     )
     SELECT id FROM sub`,
    [callerId]
  );
  return result.rows.map(r => r.id);
};

module.exports = { getTeamIds, ADMIN_ROLES, LEAF_ROLES };
