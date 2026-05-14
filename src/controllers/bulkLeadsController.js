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
 * Generate and download Excel template for bulk lead upload.
 * Sample rows are populated with REAL data from the database so they
 * change on every download and show valid project names / user names.
 */
const downloadLeadTemplate = async (req, res, next) => {
  try {
    // ── Fetch live data for dynamic sample rows ──────────────────────────
    const [projectsRes, usersRes] = await Promise.all([
      pool.query(`SELECT name FROM projects WHERE status != 'deleted' ORDER BY created_at DESC LIMIT 6`),
      pool.query(`SELECT CONCAT(first_name,' ',last_name) AS full_name, role
                  FROM users WHERE is_active = true
                  AND role IN ('sales_executive','external_caller','sales_manager')
                  ORDER BY RANDOM() LIMIT 4`),
    ]);

    const projectNames  = projectsRes.rows.map(r => r.name);
    const userNames     = usersRes.rows.map(r => r.full_name);

    // Helper — pick a random item or fallback
    const pick = (arr, fallback) => arr.length ? arr[Math.floor(Math.random() * arr.length)] : fallback;

    // Dynamic sample data — different on every download
    const sources       = ['Facebook','Instagram','Google Ads','IVR','Referral','Walk-in','99acres','Housing.com'];
    const budgets       = ['40-60 Lakhs','60-80 Lakhs','80L-1Cr','1-1.5 Crores','1.5-2 Crores','2-3 Crores'];
    const locations     = ['Andheri West','Bandra East','Powai','Thane West','Navi Mumbai','Borivali'];
    const statuses      = ['new','contacted','interested','follow_up','new','new']; // weighted towards new
    const firstNames    = ['Suresh','Priya','Amit','Neha','Rajesh','Pooja','Vikram','Anita','Ravi','Meera'];
    const lastNames     = ['Patel','Sharma','Mehta','Joshi','Singh','Gupta','Shah','Verma','Nair','Kumar'];
    const ts            = Date.now(); // ensures uniqueness per download

    const makeName  = (i) => `${pick(firstNames,`Sample${i}`)} ${pick(lastNames,'Lead')}`;
    const makePhone = (i) => `${9000000000 + ((ts + i * 137) % 999999999)}`.slice(0, 10);
    const makeEmail = (name, i) => `${name.toLowerCase().replace(/\s+/g,'.')}${(ts + i) % 1000}@example.com`;

    const sampleRows = Array.from({ length: 3 }, (_, i) => {
      const name = makeName(i);
      return {
        name,
        phone:               makePhone(i),
        email:               makeEmail(name, i),
        alternate_phone:     i === 0 ? makePhone(i + 10) : '',
        source:              pick(sources, 'Facebook'),
        budget:              pick(budgets, '60-80 Lakhs'),
        location_preference: pick(locations, 'Mumbai'),
        project_name:        pick(projectNames, 'Sample Project'),
        status:              statuses[i % statuses.length],
        assign_to:           i < userNames.length ? userNames[i] : '',
      };
    });

    const workbook  = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Lead Template');

    // Define columns with headers
    worksheet.columns = [
      { header: 'Name*',                       key: 'name',               width: 25 },
      { header: 'Phone*',                      key: 'phone',              width: 15 },
      { header: 'Email',                       key: 'email',              width: 30 },
      { header: 'Alternate Phone',             key: 'alternate_phone',    width: 15 },
      { header: 'Source',                      key: 'source',             width: 20 },
      { header: 'Budget',                      key: 'budget',             width: 20 },
      { header: 'Location Preference',         key: 'location_preference',width: 25 },
      { header: 'Project Name',                key: 'project_name',       width: 30 },
      { header: 'Status',                      key: 'status',             width: 20 },
      { header: 'Assign To (Name or Phone)',   key: 'assign_to',          width: 30 },
    ];

    // ── Style header row ────────────────────────────────────────────────
    const headerRow = worksheet.getRow(1);
    headerRow.font      = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0066CC' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height    = 20;

    // ── Dynamic sample rows ─────────────────────────────────────────────
    sampleRows.forEach((row, i) => {
      const dataRow = worksheet.addRow(row);
      // Alternate row background for readability
      dataRow.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: i % 2 === 0 ? 'FFF0F7FF' : 'FFFFFFFF' },
      };
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
      '10. Assign To: Enter the team member\'s full name or phone number to assign each lead individually',
      '11. Alternatively, you can pass assign_to (user UUID) in the API request body to assign ALL leads to one person',
      '12. Save the file and upload through the bulk upload API',
      '',
      'ASSIGNMENT RULES:',
      '- assign_to in Excel (column 10): matched by full name or phone — assigns that specific lead to that user',
      '- assign_to in API body (UUID): overrides Excel column — assigns ALL leads to that one user',
      '- If both are provided, API body takes priority for all leads',
      '- If neither is provided, leads are created as unassigned (assigned_to = NULL)',
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
 * Upload and process bulk leads from Excel file.
 *
 * Assignment logic (priority order):
 *  1. assign_to (UUID) in request body → assign ALL leads to this user
 *  2. assign_to column in Excel (col 10) → per-lead assignment matched by full name or phone
 *  3. Neither → leads created as unassigned (assigned_to = NULL)
 *
 * Body params (all optional):
 *   assign_to {string}  UUID of user to assign all leads to (overrides Excel column)
 */
const bulkUploadLeads = async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!req.file) {
      return next(new AppError('No file uploaded', 400));
    }

    // ── Assignment override from body ──────────────────────────────────────
    const globalAssignTo = req.body?.assign_to || null; // UUID — overrides Excel column

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);

    const worksheet = workbook.getWorksheet('Lead Template');
    if (!worksheet) {
      fs.unlinkSync(req.file.path);
      return next(new AppError('Invalid template. Please use the correct template.', 400));
    }

    const leads = [];
    const errors = [];
    const skipped = [];

    // ── Fetch lookup data ──────────────────────────────────────────────────
    const [projectsResult, usersResult] = await Promise.all([
      pool.query('SELECT id, name FROM projects WHERE status != $1', ['deleted']),
      pool.query(`SELECT id, CONCAT(first_name,' ',last_name) AS full_name, phone_number, role
                  FROM users WHERE is_active = true`),
    ]);

    const projectMap = new Map(
      projectsResult.rows.map((p) => [p.name.toLowerCase().trim(), p.id])
    );

    // User lookup by full name (lowercase) and by phone — for per-row assignment
    const userByName  = new Map(usersResult.rows.map((u) => [u.full_name.toLowerCase().trim(), u.id]));
    const userByPhone = new Map(usersResult.rows.map((u) => [u.phone_number?.toString().trim(), u.id]));

    // Validate global assign_to UUID if provided
    let validatedGlobalAssignTo = null;
    if (globalAssignTo) {
      const uCheck = await pool.query(
        'SELECT id, role FROM users WHERE id = $1 AND is_active = true',
        [globalAssignTo]
      );
      if (uCheck.rows.length === 0) {
        fs.unlinkSync(req.file.path);
        return next(new AppError('assign_to user not found or inactive', 400));
      }
      validatedGlobalAssignTo = uCheck.rows[0].id;
    }

    // Valid statuses
    const validStatuses = [
      'new', 'contacted', 'interested', 'follow_up',
      'site_visit_scheduled', 'site_visit_done', 'negotiation', 'booked', 'lost',
    ];

    // ── Parse rows (skip header row 1) ────────────────────────────────────
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const name             = row.getCell(1).value?.toString().trim();
      const phone            = row.getCell(2).value?.toString().trim();
      const email            = row.getCell(3).value?.toString().trim() || null;
      const alternatePhone   = row.getCell(4).value?.toString().trim() || null;
      const source           = row.getCell(5).value?.toString().trim() || null;
      const budget           = row.getCell(6).value?.toString().trim() || null;
      const locationPref     = row.getCell(7).value?.toString().trim() || null;
      const projectName      = row.getCell(8).value?.toString().trim() || null;
      let   status           = row.getCell(9).value?.toString().trim().toLowerCase() || 'new';
      const assignToRaw      = row.getCell(10).value?.toString().trim() || null; // name or phone

      // Required fields
      if (!name || !phone) {
        errors.push({ row: rowNumber, error: 'Name and Phone are required' });
        return;
      }

      // Phone: 10 digits
      const phoneRegex = /^[0-9]{10}$/;
      if (!phoneRegex.test(phone)) {
        errors.push({ row: rowNumber, error: 'Phone must be 10 digits' });
        return;
      }

      // Email format
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          errors.push({ row: rowNumber, error: 'Invalid email format' });
          return;
        }
      }

      // Status
      if (!validStatuses.includes(status)) status = 'new';

      // Project
      let projectId = null;
      if (projectName) projectId = projectMap.get(projectName.toLowerCase().trim()) || null;

      // Per-row assign_to — match by name then phone from col 10
      let rowAssignTo = null;
      if (assignToRaw) {
        rowAssignTo = userByName.get(assignToRaw.toLowerCase()) ||
                      userByPhone.get(assignToRaw) ||
                      null;
      }

      leads.push({
        name, phone, email, alternatePhone, source, budget,
        locationPref, projectId, status, rowNumber,
        rowAssignTo, // per-row from Excel col 10
      });
    });

    if (leads.length === 0) {
      fs.unlinkSync(req.file.path);
      return next(new AppError('No valid leads found in the file', 400));
    }

    // ── Insert in transaction ──────────────────────────────────────────────
    await client.query('BEGIN');

    const insertedLeads = [];
    const createdBy     = req.user.id;

    for (const lead of leads) {
      try {
        // Duplicate phone check
        const dup = await client.query('SELECT id FROM leads WHERE phone = $1', [lead.phone]);
        if (dup.rows.length > 0) {
          skipped.push({ row: lead.rowNumber, phone: lead.phone, reason: 'Duplicate phone number' });
          continue;
        }

        // Resolve final assigned_to:
        // Priority 1 — global body param
        // Priority 2 — per-row from Excel column 10
        // Priority 3 — NULL (unassigned)
        const finalAssignTo = validatedGlobalAssignTo || lead.rowAssignTo || null;

        const result = await client.query(
          `INSERT INTO leads
            (name, phone, email, alternate_phone_number, source, status, budget,
             location_preference, project_id, created_by, assigned_to)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING *`,
          [
            lead.name, lead.phone, lead.email, lead.alternatePhone,
            lead.source, lead.status, lead.budget, lead.locationPref,
            lead.projectId, createdBy, finalAssignTo,
          ]
        );

        const inserted = result.rows[0];
        insertedLeads.push(inserted);

        // Activity log
        const actNote = finalAssignTo
          ? `Lead created via bulk upload and assigned to user`
          : 'Lead created via bulk upload';
        await client.query(
          `INSERT INTO lead_activities (lead_id, type, note, performed_by) VALUES ($1,$2,$3,$4)`,
          [inserted.id, 'note', actNote, createdBy]
        );

        // Reassignment history entry if assigned
        if (finalAssignTo) {
          await client.query(
            `INSERT INTO lead_reassignment_history (lead_id, from_user_id, to_user_id, reason, performed_by)
             VALUES ($1, NULL, $2, $3, $4)`,
            [inserted.id, finalAssignTo, 'Assigned during bulk upload', createdBy]
          );
        }
      } catch (err) {
        errors.push({ row: lead.rowNumber, error: err.message });
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
    summarySheet.addRow({ metric: 'Total Rows Processed',  count: leads.length });
    summarySheet.addRow({ metric: 'Successfully Inserted',  count: insertedLeads.length });
    summarySheet.addRow({ metric: 'Skipped (Duplicates)',   count: skipped.length });
    summarySheet.addRow({ metric: 'Errors',                 count: errors.length });
    summarySheet.addRow({ metric: 'Assigned (non-null)',    count: insertedLeads.filter(l => l.assigned_to).length });
    summarySheet.addRow({ metric: 'Unassigned',             count: insertedLeads.filter(l => !l.assigned_to).length });

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
            id:          l.id,
            name:        l.name,
            phone:       l.phone,
            assigned_to: l.assigned_to || null,
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