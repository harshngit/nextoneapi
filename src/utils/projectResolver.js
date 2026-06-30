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

/**
 * Resolves a free-text project name to a project ID if one exists,
 * otherwise returns the raw string for storage.
 * Never throws — callers decide what to do with an unmatched name.
 *
 * @param {string} projectName - Free-text name typed by the user
 * @returns {Promise<{ projectId: string|null, projectNameText: string|null }>}
 */
const resolveProjectName = async (projectName) => {
  if (!projectName || typeof projectName !== 'string' || !projectName.trim()) {
    return { projectId: null, projectNameText: null };
  }
  const trimmed = projectName.trim();
  const result = await pool.query(
    'SELECT id FROM projects WHERE LOWER(name) = LOWER($1)',
    [trimmed]
  );
  if (result.rows.length > 0) {
    return { projectId: result.rows[0].id, projectNameText: null };
  }
  return { projectId: null, projectNameText: trimmed };
};

module.exports = {
  resolveProjectId,
  resolveProjectName,
};
