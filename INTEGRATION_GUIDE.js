/**
 * INTEGRATION GUIDE
 * Nextone Reality - Bulk Leads Upload & Project Documents APIs
 * 
 * This guide explains how to integrate the new features into your existing backend.
 */

// ============================================================================
// 1. INSTALL ADDITIONAL DEPENDENCY
// ============================================================================

/**
 * Add archiver package for ZIP file creation
 * Run: npm install archiver
 */

// ============================================================================
// 2. DATABASE MIGRATION
// ============================================================================

/**
 * Run the migration file: 012_project_documents_migration.sql
 * This creates the project_documents table
 * 
 * Command:
 * psql -U your_username -d your_database -f db/012_project_documents_migration.sql
 */

// ============================================================================
// 3. FILE STRUCTURE
// ============================================================================

/**
 * Place files in the following locations:
 * 
 * src/middleware/uploadMiddleware.js       (NEW)
 * src/controllers/bulkLeadsController.js   (NEW)
 * src/controllers/projectDocumentsController.js (NEW)
 * src/routes/bulkLeadsRoutes.js            (NEW)
 * src/routes/projectDocumentsRoutes.js     (NEW)
 * db/012_project_documents_migration.sql   (NEW)
 */

// ============================================================================
// 4. REGISTER ROUTES IN index.js OR app.js
// ============================================================================

/**
 * Add these lines to your main application file (src/index.js):
 */

const bulkLeadsRoutes = require('./routes/bulkLeadsRoutes');
const projectDocumentsRoutes = require('./routes/projectDocumentsRoutes');

// Register bulk leads routes
app.use('/api/v1/leads/bulk', bulkLeadsRoutes);

// Register project documents routes
app.use('/api/v1/projects', projectDocumentsRoutes);

// ============================================================================
// 5. CREATE UPLOAD DIRECTORIES
// ============================================================================

/**
 * The application will auto-create these directories, but you can pre-create them:
 * 
 * uploads/
 * ├── leads/
 * │   ├── bulk/          (Excel files uploaded for bulk import)
 * │   └── results/       (Result Excel files after processing)
 * └── projects/
 *     └── {project-id}/
 *         ├── unit_plans/ (Unit plan documents)
 *         └── creatives/  (Creative documents)
 */

// ============================================================================
// 6. API ENDPOINTS OVERVIEW
// ============================================================================

/**
 * BULK LEADS UPLOAD APIs:
 * 
 * 1. GET /api/v1/leads/bulk/template
 *    - Download Excel template for bulk upload
 *    - Returns: Excel file with instructions and sample data
 * 
 * 2. POST /api/v1/leads/bulk/upload
 *    - Upload filled Excel file with leads data
 *    - Body: multipart/form-data with 'file' field
 *    - Returns: Summary with inserted/skipped/error counts + result file URL
 * 
 * 3. GET /api/v1/leads/bulk/result/:filename
 *    - Download result Excel file after bulk upload
 *    - Returns: Excel file with detailed upload results
 * 
 * PROJECT DOCUMENTS APIs:
 * 
 * 1. POST /api/v1/projects/:id/documents
 *    - Upload unit plans and/or creatives for a project
 *    - Body: multipart/form-data with 'unit_plans[]' and/or 'creatives[]' fields
 *    - Returns: List of uploaded documents with IDs and URLs
 * 
 * 2. GET /api/v1/projects/:id/documents
 *    - Get all documents for a project (grouped by type)
 *    - Query: ?document_type=unit_plan|creative (optional filter)
 *    - Returns: Documents list with download URLs
 * 
 * 3. GET /api/v1/projects/:id/documents/download-all
 *    - Download all documents as ZIP file
 *    - Query: ?document_type=unit_plan|creative (optional filter)
 *    - Returns: ZIP file with all documents
 * 
 * 4. GET /api/v1/projects/:id/documents/:docId/download
 *    - Download a specific document
 *    - Returns: The requested file
 * 
 * 5. DELETE /api/v1/projects/:id/documents/:docId
 *    - Delete a specific document
 *    - Returns: Success message
 */

// ============================================================================
// 7. TESTING THE APIs
// ============================================================================

/**
 * BULK LEADS UPLOAD - POSTMAN/CURL EXAMPLES:
 * 
 * 1. Download Template:
 * 
 * GET http://localhost:3000/api/v1/leads/bulk/template
 * Headers: Authorization: Bearer {your_token}
 * 
 * 2. Upload Bulk Leads:
 * 
 * POST http://localhost:3000/api/v1/leads/bulk/upload
 * Headers: 
 *   Authorization: Bearer {your_token}
 *   Content-Type: multipart/form-data
 * Body:
 *   file: [Select filled Excel file]
 * 
 * 3. Download Result:
 * 
 * GET http://localhost:3000/api/v1/leads/bulk/result/upload_result_1234567890.xlsx
 * Headers: Authorization: Bearer {your_token}
 * 
 * 
 * PROJECT DOCUMENTS - POSTMAN/CURL EXAMPLES:
 * 
 * 1. Upload Documents:
 * 
 * POST http://localhost:3000/api/v1/projects/{project-id}/documents
 * Headers: 
 *   Authorization: Bearer {your_token}
 *   Content-Type: multipart/form-data
 * Body:
 *   unit_plans: [Select one or multiple files]
 *   creatives: [Select one or multiple files]
 * 
 * 2. Get All Documents:
 * 
 * GET http://localhost:3000/api/v1/projects/{project-id}/documents
 * Headers: Authorization: Bearer {your_token}
 * 
 * 3. Get Filtered Documents (only unit plans):
 * 
 * GET http://localhost:3000/api/v1/projects/{project-id}/documents?document_type=unit_plan
 * Headers: Authorization: Bearer {your_token}
 * 
 * 4. Download All as ZIP:
 * 
 * GET http://localhost:3000/api/v1/projects/{project-id}/documents/download-all
 * Headers: Authorization: Bearer {your_token}
 * 
 * 5. Download Specific Document:
 * 
 * GET http://localhost:3000/api/v1/projects/{project-id}/documents/{doc-id}/download
 * Headers: Authorization: Bearer {your_token}
 * 
 * 6. Delete Document:
 * 
 * DELETE http://localhost:3000/api/v1/projects/{project-id}/documents/{doc-id}
 * Headers: Authorization: Bearer {your_token}
 */

// ============================================================================
// 8. FRONTEND INTEGRATION EXAMPLES
// ============================================================================

/**
 * React/JavaScript example for bulk leads upload:
 */

// Download Template
async function downloadTemplate() {
  const response = await fetch('/api/v1/leads/bulk/template', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Lead_Bulk_Upload_Template.xlsx';
  a.click();
}

// Upload Bulk Leads
async function uploadBulkLeads(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch('/api/v1/leads/bulk/upload', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });
  
  const result = await response.json();
  console.log('Upload result:', result);
  
  // Download result file if needed
  if (result.data.resultFile) {
    window.open(result.data.resultFile, '_blank');
  }
}

/**
 * React/JavaScript example for project documents:
 */

// Upload Project Documents
async function uploadProjectDocs(projectId, unitPlans, creatives) {
  const formData = new FormData();
  
  // Add unit plans
  unitPlans.forEach(file => {
    formData.append('unit_plans', file);
  });
  
  // Add creatives
  creatives.forEach(file => {
    formData.append('creatives', file);
  });
  
  const response = await fetch(`/api/v1/projects/${projectId}/documents`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });
  
  const result = await response.json();
  console.log('Upload result:', result);
}

// Get Project Documents
async function getProjectDocuments(projectId, documentType = null) {
  const url = documentType 
    ? `/api/v1/projects/${projectId}/documents?document_type=${documentType}`
    : `/api/v1/projects/${projectId}/documents`;
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const result = await response.json();
  console.log('Documents:', result.data.documents);
}

// Download All Documents as ZIP
async function downloadAllDocs(projectId) {
  const response = await fetch(`/api/v1/projects/${projectId}/documents/download-all`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `project_${projectId}_documents.zip`;
  a.click();
}

// ============================================================================
// 9. VALIDATION RULES
// ============================================================================

/**
 * BULK LEADS UPLOAD:
 * - Name: Required, max 255 characters
 * - Phone: Required, exactly 10 digits
 * - Email: Optional, valid email format
 * - Status: Must be valid status from the list
 * - Duplicate phone numbers are skipped
 * - Project name must match existing project (case-insensitive)
 * 
 * PROJECT DOCUMENTS:
 * - Unit Plans: PDF, JPEG, PNG, WEBP, DOC, DOCX (max 20MB each, up to 10 files)
 * - Creatives: PDF, JPEG, PNG, WEBP, DOC, DOCX (max 20MB each, up to 10 files)
 * - Project must exist
 */

// ============================================================================
// 10. ERROR HANDLING
// ============================================================================

/**
 * All APIs return consistent error responses:
 * 
 * {
 *   "success": false,
 *   "message": "Error message here",
 *   "error": "Detailed error (in development mode)"
 * }
 * 
 * HTTP Status Codes:
 * - 200: Success
 * - 201: Created
 * - 400: Bad Request (validation errors, missing files)
 * - 404: Not Found (project/document not found)
 * - 500: Internal Server Error
 */

// ============================================================================
// 11. SECURITY NOTES
// ============================================================================

/**
 * - All endpoints require authentication (JWT token)
 * - File size limits enforced (10MB for Excel, 20MB for documents)
 * - File type validation on upload
 * - Project ownership verification
 * - SQL injection protection via parameterized queries
 * - Transaction support for data integrity
 */

// ============================================================================
// 12. PERFORMANCE CONSIDERATIONS
// ============================================================================

/**
 * - Bulk upload processes up to 1000 leads efficiently
 * - Files are streamed for download (no memory buffering)
 * - ZIP creation is done on-the-fly
 * - Database transactions ensure consistency
 * - Indexes on project_id and document_type for fast queries
 */

module.exports = {};
