/**
 * projectDocumentsController.js — Nextone Reality
 * Project document management:
 *  1. Upload multiple unit plans and creatives for a project
 *  2. Get all documents for a project
 *  3. Download specific document
 *  4. Delete document
 */

const { pool } = require('../config/db');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
// archiver v8 — use ZipArchive directly (the old archiver('zip') API is gone in v8)
const { ZipArchive } = require('archiver');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const BACKEND_URL = (process.env.BACKEND_URL || '').replace(/\/+$/, '');
const toFullUrl = (relativePath) => {
  if (!relativePath) return relativePath;
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  return `${BACKEND_URL}${relativePath.startsWith('/') ? '' : '/'}${relativePath}`;
};

/**
 * POST /api/v1/projects/:id/documents
 * Upload unit plans and creatives for a project
 */
const uploadProjectDocuments = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id: projectId } = req.params;

    // Check if project exists
    const projectCheck = await pool.query('SELECT id, name FROM projects WHERE id = $1', [
      projectId,
    ]);

    if (projectCheck.rows.length === 0) {
      return next(new AppError('Project not found', 404));
    }

    if (!req.files || (!req.files.unit_plans && !req.files.creatives && !req.files.payment_plans
        && !req.files.videos && !req.files.photos && !req.files.developer_logo)) {
      return next(new AppError('No files uploaded', 400));
    }

    const uploadedDocs = [];
    const uploadedBy = req.user.id;

    await client.query('BEGIN');

    // Process unit plans
    if (req.files.unit_plans) {
      for (const file of req.files.unit_plans) {
        const result = await client.query(
          `INSERT INTO project_documents 
            (project_id, document_type, file_name, file_path, file_size, mime_type, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            projectId,
            'unit_plan',
            file.originalname,
            file.path,
            file.size,
            file.mimetype,
            uploadedBy,
          ]
        );
        uploadedDocs.push({
          ...result.rows[0],
          url: toFullUrl(`/api/v1/projects/${projectId}/documents/${result.rows[0].id}/download`),
        });
      }
    }

    // Process creatives
    if (req.files.creatives) {
      for (const file of req.files.creatives) {
        const result = await client.query(
          `INSERT INTO project_documents 
            (project_id, document_type, file_name, file_path, file_size, mime_type, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            projectId,
            'creative',
            file.originalname,
            file.path,
            file.size,
            file.mimetype,
            uploadedBy,
          ]
        );
        uploadedDocs.push({
          ...result.rows[0],
          url: toFullUrl(`/api/v1/projects/${projectId}/documents/${result.rows[0].id}/download`),
        });
      }
    }

    // Process payment plans
    if (req.files.payment_plans) {
      for (const file of req.files.payment_plans) {
        const result = await client.query(
          `INSERT INTO project_documents 
            (project_id, document_type, file_name, file_path, file_size, mime_type, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            projectId,
            'payment_plan',
            file.originalname,
            file.path,
            file.size,
            file.mimetype,
            uploadedBy,
          ]
        );
        uploadedDocs.push({
          ...result.rows[0],
          url: toFullUrl(`/api/v1/projects/${projectId}/documents/${result.rows[0].id}/download`),
        });
      }
    }

    // Process videos
    if (req.files.videos) {
      for (const file of req.files.videos) {
        const result = await client.query(
          `INSERT INTO project_documents
            (project_id, document_type, file_name, file_path, file_size, mime_type, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            projectId,
            'video',
            file.originalname,
            file.path,
            file.size,
            file.mimetype,
            uploadedBy,
          ]
        );
        uploadedDocs.push({
          ...result.rows[0],
          url: toFullUrl(`/api/v1/projects/${projectId}/documents/${result.rows[0].id}/download`),
        });
      }
    }

    // Process photos
    if (req.files.photos) {
      for (const file of req.files.photos) {
        const result = await client.query(
          `INSERT INTO project_documents
            (project_id, document_type, file_name, file_path, file_size, mime_type, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            projectId,
            'photo',
            file.originalname,
            file.path,
            file.size,
            file.mimetype,
            uploadedBy,
          ]
        );
        uploadedDocs.push({
          ...result.rows[0],
          url: toFullUrl(`/api/v1/projects/${projectId}/documents/${result.rows[0].id}/download`),
        });
      }
    }

    // Process developer logo
    if (req.files.developer_logo) {
      for (const file of req.files.developer_logo) {
        const result = await client.query(
          `INSERT INTO project_documents
            (project_id, document_type, file_name, file_path, file_size, mime_type, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            projectId,
            'developer_logo',
            file.originalname,
            file.path,
            file.size,
            file.mimetype,
            uploadedBy,
          ]
        );
        uploadedDocs.push({
          ...result.rows[0],
          url: toFullUrl(`/api/v1/projects/${projectId}/documents/${result.rows[0].id}/download`),
        });
      }
    }

    await client.query('COMMIT');

    return sendSuccess(res, 'Documents uploaded successfully', {
      projectId,
      projectName: projectCheck.rows[0].name,
      uploadedCount: uploadedDocs.length,
      documents: uploadedDocs,
    }, 201);
  } catch (err) {
    await client.query('ROLLBACK');
    // Clean up uploaded files on error
    if (req.files) {
      if (req.files.unit_plans) {
        req.files.unit_plans.forEach((file) => {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
      }
      if (req.files.creatives) {
        req.files.creatives.forEach((file) => {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
      }
      if (req.files.payment_plans) {
        req.files.payment_plans.forEach((file) => {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
      }
      if (req.files.videos) {
        req.files.videos.forEach((file) => {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
      }
      if (req.files.photos) {
        req.files.photos.forEach((file) => {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
      }
      if (req.files.developer_logo) {
        req.files.developer_logo.forEach((file) => {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
      }
    }
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/projects/:id/documents
 * Get all documents for a project
 */
const getProjectDocuments = async (req, res, next) => {
  try {
    const { id: projectId } = req.params;
    const { document_type } = req.query; // Optional filter: 'unit_plan', 'creative', 'payment_plan', 'video'

    // Check if project exists
    const projectCheck = await pool.query('SELECT id, name FROM projects WHERE id = $1', [
      projectId,
    ]);

    if (projectCheck.rows.length === 0) {
      return next(new AppError('Project not found', 404));
    }

    let query = `
      SELECT 
        pd.id,
        pd.document_type,
        pd.file_name,
        pd.file_size,
        pd.mime_type,
        pd.uploaded_at,
        CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
      FROM project_documents pd
      LEFT JOIN users u ON u.id = pd.uploaded_by
      WHERE pd.project_id = $1
    `;

    const params = [projectId];

    if (document_type && ['unit_plan', 'creative', 'payment_plan', 'video', 'photo', 'developer_logo'].includes(document_type)) {
      query += ' AND pd.document_type = $2';
      params.push(document_type);
    }

    query += ' ORDER BY pd.uploaded_at DESC';

    const result = await pool.query(query, params);

    const documents = result.rows.map((doc) => ({
      ...doc,
      download_url: toFullUrl(`/api/v1/projects/${projectId}/documents/${doc.id}/download`),
      file_size_mb: (doc.file_size / (1024 * 1024)).toFixed(2),
    }));

    // Group by type
    const groupedDocs = {
      unit_plans: documents.filter((d) => d.document_type === 'unit_plan'),
      creatives: documents.filter((d) => d.document_type === 'creative'),
      payment_plans: documents.filter((d) => d.document_type === 'payment_plan'),
      videos: documents.filter((d) => d.document_type === 'video'),
      photos: documents.filter((d) => d.document_type === 'photo'),
      developer_logo: documents.find((d) => d.document_type === 'developer_logo') || null,
    };

    return sendSuccess(res, 'Documents fetched successfully', {
      projectId,
      projectName: projectCheck.rows[0].name,
      totalDocuments: documents.length,
      documents: groupedDocs,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/projects/:id/documents/:docId/download
 * Download a specific document
 */
const downloadProjectDocument = async (req, res, next) => {
  try {
    const { id: projectId, docId } = req.params;

    const result = await pool.query(
      `SELECT pd.*, p.name AS project_name
       FROM project_documents pd
       JOIN projects p ON p.id = pd.project_id
       WHERE pd.id = $1 AND pd.project_id = $2`,
      [docId, projectId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('Document not found', 404));
    }

    const doc = result.rows[0];

    if (!fs.existsSync(doc.file_path)) {
      return next(new AppError('File not found on server', 404));
    }

    res.download(doc.file_path, doc.file_name, (err) => {
      if (err) {
        next(err);
      }
    });
  } catch (err) {
    next(err);
  }
};

// Helper function to download documents of a specific type
const downloadDocumentsByType = async (req, res, next, documentType, folderName) => {
  try {
    const { id: projectId } = req.params;

    // Get project details
    const projectResult = await pool.query('SELECT id, name FROM projects WHERE id = $1', [
      projectId,
    ]);

    if (projectResult.rows.length === 0) {
      return next(new AppError('Project not found', 404));
    }

    const projectName = projectResult.rows[0].name;

    // Get documents of specific type
    const docsResult = await pool.query(
      'SELECT * FROM project_documents WHERE project_id = $1 AND document_type = $2',
      [projectId, documentType]
    );

    if (docsResult.rows.length === 0) {
      return next(new AppError(`No ${folderName.toLowerCase()} found for this project`, 404));
    }

    // Create ZIP archive — archiver v8 exports ZipArchive directly, not a factory function
    const archive = new ZipArchive({ zlib: { level: 9 } });

    // Set response headers
    const zipFileName = `${projectName}_${folderName.toLowerCase().replace(' ', '_')}_${Date.now()}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);

    // Pipe archive to response
    archive.pipe(res);

    // Add files to archive
    let addedCount = 0;
    for (const doc of docsResult.rows) {
      if (fs.existsSync(doc.file_path)) {
        archive.file(doc.file_path, { name: `${folderName}/${doc.file_name}` });
        addedCount++;
      }
    }

    if (addedCount === 0) {
      return next(new AppError('No valid files found to download', 404));
    }

    // Finalize archive
    await archive.finalize();
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/projects/:id/documents/download-all
 * Download all documents for a project as a ZIP file
 */
const downloadAllProjectDocuments = async (req, res, next) => {
  try {
    const { id: projectId } = req.params;
    const { document_type } = req.query; // Optional: 'unit_plan', 'creative', 'payment_plan', 'video'

    // Get project details
    const projectResult = await pool.query('SELECT id, name FROM projects WHERE id = $1', [
      projectId,
    ]);

    if (projectResult.rows.length === 0) {
      return next(new AppError('Project not found', 404));
    }

    const projectName = projectResult.rows[0].name;

    // Get documents
    let query = 'SELECT * FROM project_documents WHERE project_id = $1';
    const params = [projectId];

    if (document_type && ['unit_plan', 'creative', 'payment_plan', 'video', 'photo', 'developer_logo'].includes(document_type)) {
      query += ' AND document_type = $2';
      params.push(document_type);
    }

    const docsResult = await pool.query(query, params);

    if (docsResult.rows.length === 0) {
      return next(new AppError('No documents found for this project', 404));
    }

    // Create ZIP archive — archiver v8 exports ZipArchive directly, not a factory function
    const archive = new ZipArchive({ zlib: { level: 9 } });

    // Set response headers
    const zipFileName = document_type
      ? `${projectName}_${document_type}s_${Date.now()}.zip`
      : `${projectName}_all_documents_${Date.now()}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);

    // Pipe archive to response
    archive.pipe(res);

    // Add files to archive
    let addedCount = 0;
    for (const doc of docsResult.rows) {
      if (fs.existsSync(doc.file_path)) {
        const folderName = doc.document_type === 'unit_plan' ? 'Unit Plans'
        : doc.document_type === 'creative' ? 'Creatives'
        : doc.document_type === 'payment_plan' ? 'Payment Plans'
        : doc.document_type === 'photo' ? 'Photos'
        : doc.document_type === 'developer_logo' ? 'Developer Logo'
        : 'Videos';
        archive.file(doc.file_path, { name: `${folderName}/${doc.file_name}` });
        addedCount++;
      }
    }

    if (addedCount === 0) {
      return next(new AppError('No valid files found to download', 404));
    }

    // Finalize archive
    await archive.finalize();
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/projects/:id/documents/unit-plans/download-all
 * Download all unit plans for a project as a ZIP file
 */
const downloadAllUnitPlans = (req, res, next) => {
  return downloadDocumentsByType(req, res, next, 'unit_plan', 'Unit Plans');
};

/**
 * GET /api/v1/projects/:id/documents/creatives/download-all
 * Download all creatives for a project as a ZIP file
 */
const downloadAllCreatives = (req, res, next) => {
  return downloadDocumentsByType(req, res, next, 'creative', 'Creatives');
};

/**
 * GET /api/v1/projects/:id/documents/payment-plans/download-all
 * Download all payment plans for a project as a ZIP file
 */
const downloadAllPaymentPlans = (req, res, next) => {
  return downloadDocumentsByType(req, res, next, 'payment_plan', 'Payment Plans');
};

/**
 * GET /api/v1/projects/:id/documents/videos/download-all
 * Download all videos for a project as a ZIP file
 */
const downloadAllVideos = (req, res, next) => {
  return downloadDocumentsByType(req, res, next, 'video', 'Videos');
};

/**
 * DELETE /api/v1/projects/:id/documents/:docId
 * Delete a specific document
 */
const deleteProjectDocument = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id: projectId, docId } = req.params;

    await client.query('BEGIN');

    const result = await client.query(
      'SELECT * FROM project_documents WHERE id = $1 AND project_id = $2',
      [docId, projectId]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return next(new AppError('Document not found', 404));
    }

    const doc = result.rows[0];

    // Delete from database
    await client.query('DELETE FROM project_documents WHERE id = $1', [docId]);

    // Delete file from filesystem
    if (fs.existsSync(doc.file_path)) {
      fs.unlinkSync(doc.file_path);
    }

    await client.query('COMMIT');

    return sendSuccess(res, 'Document deleted successfully', {
      deletedDocumentId: docId,
      fileName: doc.file_name,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

/**
 * POST /api/v1/projects/upload-unit-plan
 * Upload a single unit plan (no project ID required)
 */
const uploadStandaloneUnitPlan = async (req, res, next) => {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return next(new AppError('No unit plan file uploaded', 400));
    }

    const fileData = {
      file_name: file.originalname,
      file_path: file.path.replace(/\\/g, '/'),
      file_size: file.size,
      mime_type: file.mimetype,
      url: toFullUrl(`/uploads/projects/temp/unit_plans/${file.filename}`),
      document_type: 'unit_plan'
    };

    return sendSuccess(res, 'Unit plan uploaded successfully', fileData, 201);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/projects/upload-creative
 * Upload a single creative (no project ID required)
 */
const uploadStandaloneCreative = async (req, res, next) => {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return next(new AppError('No creative file uploaded', 400));
    }

    const fileData = {
      file_name: file.originalname,
      file_path: file.path.replace(/\\/g, '/'),
      file_size: file.size,
      mime_type: file.mimetype,
      url: toFullUrl(`/uploads/projects/temp/creatives/${file.filename}`),
      document_type: 'creative'
    };

    return sendSuccess(res, 'Creative uploaded successfully', fileData, 201);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/projects/upload-payment-plan
 * Upload a single payment plan (no project ID required)
 */
const uploadStandalonePaymentPlan = async (req, res, next) => {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return next(new AppError('No payment plan file uploaded', 400));
    }

    const fileData = {
      file_name: file.originalname,
      file_path: file.path.replace(/\\/g, '/'),
      file_size: file.size,
      mime_type: file.mimetype,
      url: toFullUrl(`/uploads/projects/temp/payment_plans/${file.filename}`),
      document_type: 'payment_plan'
    };

    return sendSuccess(res, 'Payment plan uploaded successfully', fileData, 201);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/projects/upload-video
 * Upload a single video (no project ID required)
 */
const uploadStandaloneVideo = async (req, res, next) => {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return next(new AppError('No video file uploaded', 400));
    }

    const fileData = {
      file_name: file.originalname,
      file_path: file.path.replace(/\\/g, '/'),
      file_size: file.size,
      mime_type: file.mimetype,
      url: toFullUrl(`/uploads/projects/temp/videos/${file.filename}`),
      document_type: 'video'
    };

    return sendSuccess(res, 'Video uploaded successfully', fileData, 201);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/projects/upload-photo
 * Upload a single project photo (no project ID required)
 */
const uploadStandalonePhoto = async (req, res, next) => {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return next(new AppError('No photo file uploaded', 400));
    }

    const fileData = {
      file_name: file.originalname,
      file_path: file.path.replace(/\\/g, '/'),
      file_size: file.size,
      mime_type: file.mimetype,
      url: toFullUrl(`/uploads/projects/temp/photos/${file.filename}`),
      document_type: 'photo'
    };

    return sendSuccess(res, 'Photo uploaded successfully', fileData, 201);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/projects/upload-developer-logo
 * Upload a developer logo (no project ID required)
 */
const uploadStandaloneDeveloperLogo = async (req, res, next) => {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return next(new AppError('No developer logo file uploaded', 400));
    }

    const fileData = {
      file_name: file.originalname,
      file_path: file.path.replace(/\\/g, '/'),
      file_size: file.size,
      mime_type: file.mimetype,
      url: toFullUrl(`/uploads/projects/temp/developer_logo/${file.filename}`),
      document_type: 'developer_logo'
    };

    return sendSuccess(res, 'Developer logo uploaded successfully', fileData, 201);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  uploadProjectDocuments,
  getProjectDocuments,
  downloadProjectDocument,
  downloadAllProjectDocuments,
  downloadAllUnitPlans,
  downloadAllCreatives,
  downloadAllPaymentPlans,
  downloadAllVideos,
  deleteProjectDocument,
  uploadStandaloneUnitPlan,
  uploadStandaloneCreative,
  uploadStandalonePaymentPlan,
  uploadStandaloneVideo,
  uploadStandalonePhoto,
  uploadStandaloneDeveloperLogo,
};