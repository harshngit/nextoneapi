/**
 * bulkLeadsController.js — Nextone Reality
 * Bulk lead operations:
 *  1. Generate Excel template for bulk upload
 *  2. Bulk upload leads from Excel file
 *  3. Download template with sample data
 */

const { pool } = require('../config/db');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

/**
 * GET /api/v1/leads/bulk/template
 * Generate and download Excel template for bulk lead upload
 */
const downloadLeadTemplate = async (req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Lead Template');

    // Define columns with headers
    worksheet.columns = [
      { header: 'Name*', key: 'name', width: 25 },
      { header: 'Phone*', key: 'phone', width: 15 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Alternate Phone', key: 'alternate_phone', width: 15 },
      { header: 'Source', key: 'source', width: 20 },
      { header: 'Budget', key: 'budget', width: 20 },
      { header: 'Location Preference', key: 'location_preference', width: 25 },
      { header: 'Project Name', key: 'project_name', width: 30 },
      { header: 'Status', key: 'status', width: 20 },
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0066CC' },
    };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    // Add sample data rows
    worksheet.addRow({
      name: 'John Doe',
      phone: '9876543210',
      email: 'john.doe@example.com',
      alternate_phone: '9988776655',
      source: 'Website',
      budget: '50-75 Lakhs',
      location_preference: 'Andheri, Mumbai',
      project_name: 'Sky Heights',
      status: 'new',
    });

    worksheet.addRow({
      name: 'Jane Smith',
      phone: '8765432109',
      email: 'jane.smith@example.com',
      alternate_phone: '',
      source: 'Referral',
      budget: '1-2 Crores',
      location_preference: 'Powai, Mumbai',
      project_name: 'Lake View Residency',
      status: 'interested',
    });

    // Add instructions worksheet
    const instructionsSheet = workbook.addWorksheet('Instructions');
    instructionsSheet.columns = [{ header: 'Instructions', key: 'instruction', width: 80 }];

    const instructions = [
      'HOW TO USE THIS TEMPLATE:',
      '',
      '1. Fill in the lead details in the "Lead Template" sheet',
      '2. Fields marked with * are mandatory (Name and Phone)',
      '3. Status values: new, contacted, interested, follow_up, site_visit_scheduled, site_visit_done, negotiation, booked, lost',
      '4. Source examples: Website, Facebook, Instagram, Referral, Walk-in, Phone Call',
      '5. Budget format: "50-75 Lakhs", "1-2 Crores", etc.',
      '6. Project Name must match existing project names in the system',
      '7. If Project Name is not found, the lead will be created without project assignment',
      '8. Phone numbers should be 10 digits (Indian format)',
      '9. Email must be in valid format (e.g., user@example.com)',
      '10. Save the file and upload through the bulk upload API',
      '',
      'VALIDATION RULES:',
      '- Name: Required, maximum 255 characters',
      '- Phone: Required, 10 digits',
      '- Email: Optional, valid email format',
      '- Status: Must be one of the valid status values listed above',
      '',
      'NOTE: Duplicate phone numbers will be skipped during upload',
    ];

    instructions.forEach((instruction, index) => {
      const row = instructionsSheet.addRow({ instruction });
      if (index === 0) {
        row.font = { bold: true, size: 14 };
      } else if (instruction === '' || instruction.startsWith('HOW TO') || instruction.startsWith('VALIDATION')) {
        row.font = { bold: true };
      }
    });

    // Set response headers
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename=Lead_Bulk_Upload_Template.xlsx');

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/leads/bulk/upload
 * Upload and process bulk leads from Excel file
 */
const bulkUploadLeads = async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!req.file) {
      return next(new AppError('No file uploaded', 400));
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);

    const worksheet = workbook.getWorksheet('Lead Template');
    if (!worksheet) {
      fs.unlinkSync(req.file.path); // Clean up uploaded file
      return next(new AppError('Invalid template. Please use the correct template.', 400));
    }

    const leads = [];
    const errors = [];
    const skipped = [];

    // Fetch all projects for name matching
    const projectsResult = await pool.query('SELECT id, name FROM projects');
    const projectMap = new Map(
      projectsResult.rows.map((p) => [p.name.toLowerCase().trim(), p.id])
    );

    // Valid statuses
    const validStatuses = [
      'new',
      'contacted',
      'interested',
      'follow_up',
      'site_visit_scheduled',
      'site_visit_done',
      'negotiation',
      'booked',
      'lost',
    ];

    // Parse rows (skip header)
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      const name = row.getCell(1).value?.toString().trim();
      const phone = row.getCell(2).value?.toString().trim();
      const email = row.getCell(3).value?.toString().trim() || null;
      const alternatePhone = row.getCell(4).value?.toString().trim() || null;
      const source = row.getCell(5).value?.toString().trim() || null;
      const budget = row.getCell(6).value?.toString().trim() || null;
      const locationPreference = row.getCell(7).value?.toString().trim() || null;
      const projectName = row.getCell(8).value?.toString().trim() || null;
      let status = row.getCell(9).value?.toString().trim().toLowerCase() || 'new';

      // Validation
      if (!name || !phone) {
        errors.push({ row: rowNumber, error: 'Name and Phone are required' });
        return;
      }

      // Phone validation (10 digits)
      const phoneRegex = /^[0-9]{10}$/;
      if (!phoneRegex.test(phone)) {
        errors.push({ row: rowNumber, error: 'Phone must be 10 digits' });
        return;
      }

      // Email validation
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          errors.push({ row: rowNumber, error: 'Invalid email format' });
          return;
        }
      }

      // Status validation
      if (!validStatuses.includes(status)) {
        status = 'new'; // Default to new if invalid
      }

      // Project matching
      let projectId = null;
      if (projectName) {
        projectId = projectMap.get(projectName.toLowerCase().trim()) || null;
      }

      leads.push({
        name,
        phone,
        email,
        alternatePhone,
        source,
        budget,
        locationPreference,
        projectId,
        status,
        rowNumber,
      });
    });

    if (leads.length === 0) {
      fs.unlinkSync(req.file.path);
      return next(new AppError('No valid leads found in the file', 400));
    }

    // Start transaction
    await client.query('BEGIN');

    const insertedLeads = [];
    const createdBy = req.user.id;

    for (const lead of leads) {
      try {
        // Check for duplicate phone
        const existingLead = await client.query(
          'SELECT id FROM leads WHERE phone = $1',
          [lead.phone]
        );

        if (existingLead.rows.length > 0) {
          skipped.push({
            row: lead.rowNumber,
            phone: lead.phone,
            reason: 'Duplicate phone number',
          });
          continue;
        }

        // Insert lead
        const result = await client.query(
          `INSERT INTO leads 
            (name, phone, email, alternate_phone_number, source, status, budget, 
             location_preference, project_id, created_by, assigned_to)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL)
           RETURNING *`,
          [
            lead.name,
            lead.phone,
            lead.email,
            lead.alternatePhone,
            lead.source,
            lead.status,
            lead.budget,
            lead.locationPreference,
            lead.projectId,
            createdBy,
          ]
        );

        insertedLeads.push(result.rows[0]);

        // Log activity
        await client.query(
          `INSERT INTO lead_activities (lead_id, type, note, performed_by)
           VALUES ($1, $2, $3, $4)`,
          [
            result.rows[0].id,
            'note',
            'Lead created via bulk upload',
            createdBy,
          ]
        );
      } catch (err) {
        errors.push({
          row: lead.rowNumber,
          error: err.message,
        });
      }
    }

    await client.query('COMMIT');

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    // Generate result Excel with summary
    const resultWorkbook = new ExcelJS.Workbook();
    const summarySheet = resultWorkbook.addWorksheet('Upload Summary');

    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Count', key: 'count', width: 15 },
    ];

    summarySheet.getRow(1).font = { bold: true };
    summarySheet.addRow({ metric: 'Total Rows Processed', count: leads.length });
    summarySheet.addRow({ metric: 'Successfully Inserted', count: insertedLeads.length });
    summarySheet.addRow({ metric: 'Skipped (Duplicates)', count: skipped.length });
    summarySheet.addRow({ metric: 'Errors', count: errors.length });

    // Add errors sheet if any
    if (errors.length > 0) {
      const errorsSheet = resultWorkbook.addWorksheet('Errors');
      errorsSheet.columns = [
        { header: 'Row Number', key: 'row', width: 15 },
        { header: 'Error', key: 'error', width: 50 },
      ];
      errorsSheet.getRow(1).font = { bold: true };
      errors.forEach((e) => errorsSheet.addRow(e));
    }

    // Add skipped sheet if any
    if (skipped.length > 0) {
      const skippedSheet = resultWorkbook.addWorksheet('Skipped');
      skippedSheet.columns = [
        { header: 'Row Number', key: 'row', width: 15 },
        { header: 'Phone', key: 'phone', width: 15 },
        { header: 'Reason', key: 'reason', width: 40 },
      ];
      skippedSheet.getRow(1).font = { bold: true };
      skipped.forEach((s) => skippedSheet.addRow(s));
    }

    // Save result file
    const resultDir = path.join(process.cwd(), 'uploads', 'leads', 'results');
    fs.mkdirSync(resultDir, { recursive: true });

    const resultFilename = `upload_result_${Date.now()}.xlsx`;
    const resultPath = path.join(resultDir, resultFilename);
    await resultWorkbook.xlsx.writeFile(resultPath);

    return sendSuccess(
      res,
      'Bulk upload completed',
      {
        total: leads.length,
        inserted: insertedLeads.length,
        skipped: skipped.length,
        errors: errors.length,
        resultFile: `/uploads/leads/results/${resultFilename}`,
        summary: {
          insertedLeads: insertedLeads.map((l) => ({
            id: l.id,
            name: l.name,
            phone: l.phone,
          })),
          errors: errors.slice(0, 10), // First 10 errors only
          skipped: skipped.slice(0, 10), // First 10 skipped only
        },
      },
      201
    );
  } catch (err) {
    await client.query('ROLLBACK');
    // Clean up uploaded file if exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/v1/leads/bulk/result/:filename
 * Download result file after bulk upload
 */
const downloadResultFile = async (req, res, next) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(process.cwd(), 'uploads', 'leads', 'results', filename);

    if (!fs.existsSync(filePath)) {
      return next(new AppError('Result file not found', 404));
    }

    res.download(filePath, filename, (err) => {
      if (err) {
        next(err);
      }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  downloadLeadTemplate,
  bulkUploadLeads,
  downloadResultFile,
};
