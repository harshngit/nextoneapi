const { pool } = require('../config/db');
const AppError = require('./AppError');

/**
 * Resolves a project identifier to a project ID.
 * Accepts either a UUID or a project name.
 * 
 * @param {string} projectIdentifier - Either a UUID or project name
 * @returns {Promise<string|null>} The resolved project ID, or null if not provided
 * @throws {AppError} If no matching project is found
 */
const resolveProjectId = async (projectIdentifier) => {
  if (!projectIdentifier) {
    return null;
  }

  // First, check if it's a valid UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(projectIdentifier)) {
    // Verify the UUID actually exists
    const result = await pool.query(
      'SELECT id FROM projects WHERE id = $1',
      [projectIdentifier]
    );
    if (result.rows.length > 0) {
      return projectIdentifier;
    }
  }

  // If not a UUID or UUID not found, try by name (case-insensitive)
  const nameResult = await pool.query(
    'SELECT id FROM projects WHERE LOWER(name) = LOWER($1)',
    [projectIdentifier]
  );
  
  if (nameResult.rows.length > 0) {
    return nameResult.rows[0].id;
  }

  throw new AppError(`Project not found with identifier: ${projectIdentifier}`, 404);
};

module.exports = {
  resolveProjectId
};
