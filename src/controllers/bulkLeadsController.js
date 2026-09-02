/**
 * bulkLeadsController.js — Nextone Reality
 *
 * Template columns (exact order):
 *  1.  Name*                 — required
 *  2.  Phone Number*         — required, 10 digits
 *  3.  Alternate Phone       — optional
 *  4.  Source                — dropdown from lead_sources table
 *  5.  Budget                — free text (no dropdown)
 *  6.  Location Preference   — free text (no dropdown)
 *  7.  Project Name          — dropdown from projects table
 *  8.  Status                — dropdown from lead_statuses table
 *  9.  Assign To             — dropdown from users (non-super_admin)
 *  10. Configuration         — dropdown of all unique configs across projects (e.g. 1BHK, 2BHK)
 *
 * Required fields for bulk upload:
 *   Name, Phone Number, Budget, Location Preference, Configuration
 *
 * Duplicate phones: a phone number already registered to an active (non-archived)
 * lead cannot be reused — matching rows are skipped. Same rule as POST /api/v1/leads.
 */

const { pool }        = require('../config/db');
const { sendSuccess } = require('../utils/response');
const AppError        = require('../utils/AppError');
const ExcelJS         = require('exceljs');
const fs              = require('fs');
const path            = require('path');

// ─── Helper ────────────────────────────────────────────────────────────────────
const pick = (arr, fallback) =>
  arr.length ? arr[Math.floor(Math.random() * arr.length)] : fallback;

// ─── Hidden sheet helper ────────────────────────────────────────────────────────
/**
 * Creates a very-hidden worksheet whose column A holds the dropdown values,
 * then attaches a list data-validation to the target range on the main sheet.
 */
const addDropdown = (workbook, mainSheet, targetRange, sheetName, values, promptTitle, promptMsg, errorStyle = 'stop') => {
  const hidden = workbook.addWorksheet(sheetName);
  hidden.state = 'veryHidden';
  values.forEach((v, i) => { hidden.getCell(i + 1, 1).value = v; });

  mainSheet.dataValidations.add(targetRange, {
    type:             'list',
    allowBlank:       true,
    formulae:         [`${sheetName}!$A$1:$A$${values.length}`],
    showErrorMessage: true,
    errorStyle,
    errorTitle:       'Invalid value',
    error:            errorStyle === 'warning'
      ? `This value isn't in the dropdown list — you can still type a custom value if needed.`
      : `Please select a value from the dropdown list.`,
    showInputMessage: true,
    promptTitle:      promptTitle,
    prompt:           promptMsg,
  });
};

// ─── GET /api/v1/leads/bulk/template ──────────────────────────────────────────
/**
 * Generates and streams an Excel template.
 * All dropdown lists are pulled live from the DB so they reflect
 * current admin config every time the template is downloaded.
 */
const downloadLeadTemplate = async (req, res, next) => {
  try {
    // ── 1. Fetch all dropdown data in parallel ─────────────────────────────
    const [sourcesRes, statusesRes, projectsRes, usersRes, configsRes] = await Promise.all([
      // Lead sources from config table
      pool.query(`
        SELECT name FROM lead_sources
        WHERE is_active = true
        ORDER BY name ASC
      `),
      // Lead statuses from config table
      pool.query(`
        SELECT key FROM lead_statuses
        WHERE is_active = true
        ORDER BY sort_order ASC, label ASC
      `),
      // Active projects for project name dropdown + sample rows
      pool.query(`
        SELECT id, name, configurations
        FROM projects
        WHERE status != 'deleted'
        ORDER BY created_at DESC
      `),
      // All active non-super_admin users for Assign To dropdown
      pool.query(`
        SELECT CONCAT(first_name, ' ', last_name) AS full_name
        FROM users
        WHERE is_active = true
          AND role != 'super_admin'
        ORDER BY first_name ASC
      `),
      // All unique configurations across all active projects (e.g. 1BHK, 2BHK)
      pool.query(`
        SELECT DISTINCT TRIM(cfg::text, '"') AS config_value
        FROM projects,
             jsonb_array_elements(
               CASE jsonb_typeof(configurations)
                 WHEN 'array' THEN configurations
                 ELSE '[]'::jsonb
               END
             ) AS cfg
        WHERE status != 'deleted'
          AND cfg::text != '""'
          AND cfg::text != 'null'
        ORDER BY config_value ASC
      `),
    ]);

    const sourceList  = sourcesRes.rows.map(r => r.name);
    const statusList  = statusesRes.rows.map(r => r.key);
    const projectList = projectsRes.rows.map(r => r.name);
    const userList    = usersRes.rows.map(r => r.full_name);
    const configList  = configsRes.rows.map(r => r.config_value).filter(Boolean);

    // Fallback lists if DB has no data yet
    const safeSourceList  = sourceList.length  ? sourceList  : ['Facebook', 'Instagram', 'Google Ads', 'Referral', 'Walk-in', 'IVR'];
    const safeStatusList  = statusList.length   ? statusList  : ['new', 'contacted', 'interested', 'follow_up', 'booked', 'lost'];
    const safeConfigList  = configList.length   ? configList  : ['1BHK', '2BHK', '3BHK', '4BHK', 'Studio', 'Villa'];

    // ── 2. Build sample rows ───────────────────────────────────────────────
    const firstNames = ['Suresh', 'Priya', 'Amit', 'Neha', 'Rajesh', 'Pooja', 'Vikram', 'Anita'];
    const lastNames  = ['Patel', 'Sharma', 'Mehta', 'Joshi', 'Singh', 'Gupta', 'Shah', 'Verma'];
    const budgets    = ['40-60 Lakhs', '60-80 Lakhs', '80L-1Cr', '1-1.5 Crores', '1.5-2 Crores'];
    const locations  = ['Andheri West', 'Bandra East', 'Powai', 'Thane West', 'Navi Mumbai', 'Borivali'];
    const ts         = Date.now();

    const makeName  = (i) => `${pick(firstNames, `Sample${i}`)} ${pick(lastNames, 'Lead')}`;
    const makePhone = (i) => `${9000000000 + ((ts + i * 137) % 999999999)}`.slice(0, 10);

    const sampleRows = Array.from({ length: 3 }, (_, i) => ({
      name:               makeName(i),
      phone:              makePhone(i),
      alternate_phone:    i === 0 ? makePhone(i + 10) : '',
      source:             pick(safeSourceList, 'Facebook'),
      budget:             pick(budgets, '60-80 Lakhs'),
      location:           pick(locations, 'Mumbai'),
      project_name:       pick(projectList, ''),
      status:             pick(safeStatusList, 'new'),
      assign_to:          i < userList.length ? userList[i] : '',
      configuration:      pick(safeConfigList, '2BHK'),
    }));

    // ── 3. Build workbook ──────────────────────────────────────────────────
    const workbook  = new ExcelJS.Workbook();
    const ws        = workbook.addWorksheet('Lead Template');

    ws.columns = [
      { header: 'Name*',                key: 'name',            width: 25 },
      { header: 'Phone Number*',        key: 'phone',           width: 16 },
      { header: 'Alternate Phone',      key: 'alternate_phone', width: 16 },
      { header: 'Source',               key: 'source',          width: 20 },
      { header: 'Budget',               key: 'budget',          width: 20 },
      { header: 'Location Preference',  key: 'location',        width: 25 },
      { header: 'Project Name',         key: 'project_name',    width: 30 },
      { header: 'Status',               key: 'status',          width: 22 },
      { header: 'Assign To',            key: 'assign_to',       width: 28 },
      { header: 'Configuration*',       key: 'configuration',   width: 20 },
    ];

    // Style header row
    const headerRow = ws.getRow(1);
    headerRow.font      = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0066CC' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height    = 22;

    // Sample rows with alternating background
    sampleRows.forEach((row, i) => {
      const dataRow = ws.addRow(row);
      dataRow.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: i % 2 === 0 ? 'FFF0F7FF' : 'FFFFFFFF' },
      };
    });

    // ── 4. Attach dropdowns via hidden sheets ──────────────────────────────
    // Col D (4) — Source
    if (safeSourceList.length) {
      addDropdown(workbook, ws, 'D2:D1000', '_Sources', safeSourceList,
        'Source', 'Select the lead source from the list.');
    }

    // Col G (7) — Project Name. errorStyle 'warning' (not the default 'stop')
    // so a name typed that isn't in the dropdown is still accepted — it's
    // stored as free text on the lead if it doesn't match an existing project.
    if (projectList.length) {
      addDropdown(workbook, ws, 'G2:G1000', '_Projects', projectList,
        'Project Name', 'Select a project from the list, or type a name if it is not listed.',
        'warning');
    }

    // Col H (8) — Status
    addDropdown(workbook, ws, 'H2:H1000', '_Statuses', safeStatusList,
      'Status', 'Select the lead status.');

    // Col I (9) — Assign To
    if (userList.length) {
      addDropdown(workbook, ws, 'I2:I1000', '_Users', userList,
        'Assign To', 'Select the team member to assign this lead to.');
    }

    // Col J (10) — Configuration
    if (safeConfigList.length) {
      addDropdown(workbook, ws, 'J2:J1000', '_Configs', safeConfigList,
        'Configuration', 'Select the unit type the lead is interested in (e.g. 2BHK).');
    }

    // ── 5. Instructions sheet ──────────────────────────────────────────────
    const instrSheet = workbook.addWorksheet('Instructions');
    instrSheet.columns = [{ header: 'Instructions', key: 'text', width: 85 }];

    const lines = [
      'HOW TO USE THIS TEMPLATE:',
      '',
      'REQUIRED FIELDS (marked with *):',
      '  • Name             (column A) — Lead full name',
      '  • Phone Number     (column B) — any format accepted, including international numbers with a country code',
      '',
      'OPTIONAL FIELDS:',
      '  • Alternate Phone  (column C) — any format accepted, same as Phone Number',
      '  • Source           (column D) — select from dropdown (admin-configured)',
      '  • Budget           (column E) — free text, e.g. "60-80 Lakhs"',
      '  • Location         (column F) — free text, e.g. "Andheri West"',
      '  • Project Name     (column G) — select from the dropdown OR just type a name —',
      '                        if it does not match an existing project, it is saved as-is on the lead',
      '  • Status           (column H) — select from dropdown (defaults to "new" if blank)',
      '  • Assign To        (column I) — select team member from dropdown',
      '  • Configuration    (column J) — select from dropdown, e.g. "2BHK"',
      '',
      'DROPDOWN FIELDS:',
      '  Source, Project Name, Status, Assign To, and Configuration all have',
      '  live dropdowns pulled from the system at the time of template download.',
      '  Project Name additionally accepts free text if your value is not listed;',
      '  the other dropdowns should have their value added by an admin first.',
      '',
      'ASSIGNMENT RULES:',
      '  • Assign To (col I): assigns that specific lead to that user',
      '  • assign_to UUID in API body: overrides col I and assigns ALL leads to one user',
      '  • If neither is set, leads are created as unassigned',
      '',
      'VALIDATION RULES:',
      '  • Only Name and Phone Number are required — rows missing either are skipped',
      '  • Phone / Alternate Phone: no format restriction — international numbers are fine',
      '  • A phone number already used by an active lead cannot be reused — rows with a duplicate number are skipped',
      '',
      'NOTE: Do not rename or reorder columns. Save as .xlsx before uploading.',
    ];

    lines.forEach((line, idx) => {
      const r = instrSheet.addRow({ text: line });
      if (idx === 0)                          r.font = { bold: true, size: 14 };
      else if (line.endsWith(':') && line.trim() !== '') r.font = { bold: true };
    });

    // ── 6. Stream response ─────────────────────────────────────────────────
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename=Lead_Bulk_Upload_Template.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/v1/leads/bulk/upload ───────────────────────────────────────────
/**
 * Processes the uploaded Excel file.
 *
 * Required per row: name, phone, budget, location_preference, configuration
 * Optional per row: alternate_phone, source, project_name, status, assign_to
 *
 * Duplicate phones: a phone number already registered to an active
 * (non-archived) lead — including one inserted earlier in this same file —
 * is skipped, not errored. Same rule as POST /api/v1/leads.
 *
 * Assignment priority:
 *   1. assign_to UUID in body  → all leads
 *   2. Assign To col (I)       → per-lead (matched by name)
 *   3. null                    → unassigned
 */
const bulkUploadLeads = async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!req.file) return next(new AppError('No file uploaded', 400));

    const globalAssignTo = req.body?.assign_to || null;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);

    const ws = workbook.getWorksheet('Lead Template');
    if (!ws) {
      fs.unlinkSync(req.file.path);
      return next(new AppError('Invalid template. Please download and use the latest template.', 400));
    }

    // ── Lookup tables ─────────────────────────────────────────────────────
    const [projectsRes, usersRes, sourcesRes, statusesRes] = await Promise.all([
      pool.query(`SELECT id, name FROM projects WHERE status != 'deleted'`),
      pool.query(`
        SELECT id, CONCAT(first_name, ' ', last_name) AS full_name, phone_number, role
        FROM users WHERE is_active = true
      `),
      pool.query(`SELECT name FROM lead_sources WHERE is_active = true`),
      pool.query(`SELECT key FROM lead_statuses WHERE is_active = true`),
    ]);

    const projectMap   = new Map(projectsRes.rows.map(p => [p.name.toLowerCase().trim(), p.id]));
    const userByName   = new Map(usersRes.rows.map(u => [u.full_name.toLowerCase().trim(), u.id]));
    const validSources = new Set(sourcesRes.rows.map(s => s.name.toLowerCase()));
    const validStatuses = new Set(statusesRes.rows.map(s => s.key.toLowerCase()));

    // Validate global assign_to UUID
    let validatedGlobalAssignTo = null;
    if (globalAssignTo) {
      const uCheck = await pool.query(
        `SELECT id FROM users WHERE id = $1 AND is_active = true`, [globalAssignTo]
      );
      if (!uCheck.rows.length) {
        fs.unlinkSync(req.file.path);
        return next(new AppError('assign_to user not found or inactive', 400));
      }
      validatedGlobalAssignTo = uCheck.rows[0].id;
    }

    const leads   = [];
    const errors  = [];
    const skipped = [];

    // ── Parse rows ────────────────────────────────────────────────────────
    // Column mapping (1-indexed):
    //  1 name | 2 phone | 3 alternate_phone | 4 source | 5 budget
    //  6 location | 7 project_name | 8 status | 9 assign_to | 10 configuration
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return; // skip header

      const cell = (n) => row.getCell(n).value?.toString().trim() || '';

      const name          = cell(1);
      const phone         = cell(2);
      const altPhone      = cell(3) || null;
      const source        = cell(4) || null;
      const budget        = cell(5);
      const location      = cell(6);
      const projectName   = cell(7) || null;
      let   status        = cell(8).toLowerCase() || 'new';
      const assignToRaw   = cell(9) || null;
      const configuration = cell(10);

      // ── Required field validation ──────────────────────────────────────
      // Only Name and Phone are actually required — matches the regular
      // POST /api/v1/leads API (budget/location/configuration are optional
      // there too), so bulk upload shouldn't be stricter.
      const missing = [];
      if (!name)  missing.push('Name');
      if (!phone) missing.push('Phone Number');

      if (missing.length) {
        errors.push({ row: rowNum, error: `Missing required fields: ${missing.join(', ')}` });
        return;
      }

      // No format validation on phone/alternate phone — international numbers
      // (country codes, varying lengths) are accepted as-is, same as the
      // regular POST /api/v1/leads API.

      // Source: accept if in config or leave as-is (admin may have typed a valid one)
      const resolvedSource = source
        ? (validSources.has(source.toLowerCase()) ? source : source)
        : null;

      // Status: default to 'new' if not recognised
      if (!validStatuses.has(status)) status = 'new';

      // Project — dropdown match wins; if the typed name doesn't match any
      // existing project, keep it as free text rather than discarding it.
      let projectId = null;
      let projectNameText = null;
      if (projectName) {
        const matchedId = projectMap.get(projectName.toLowerCase().trim());
        if (matchedId) {
          projectId = matchedId;
        } else {
          projectNameText = projectName.trim();
        }
      }

      // Per-row assign_to — match by full name
      let rowAssignTo = null;
      if (assignToRaw) {
        rowAssignTo = userByName.get(assignToRaw.toLowerCase().trim()) || null;
      }

      leads.push({
        rowNum,
        name, phone,
        alternate_phone: altPhone,
        source:          resolvedSource,
        budget,
        location_preference: location,
        project_id:      projectId,
        project_name_text: projectNameText,
        status,
        configuration,
        rowAssignTo,
      });
    });

    if (!leads.length) {
      fs.unlinkSync(req.file.path);
      return next(new AppError('No valid leads found in the file', 400));
    }

    // ── Insert ────────────────────────────────────────────────────────────
    await client.query('BEGIN');

    const inserted   = [];
    const createdBy  = req.user.id;

    for (const lead of leads) {
      try {
        // Duplicate phone check — queried within this same transaction, so an
        // earlier row in this same file that was already inserted counts too.
        const dup = await client.query(
          `SELECT id, name FROM leads WHERE phone = $1 AND is_archived = false LIMIT 1`, [lead.phone]
        );
        if (dup.rows.length) {
          skipped.push({
            row: lead.rowNum, phone: lead.phone,
            reason: `Duplicate phone number — already registered with lead "${dup.rows[0].name}"`,
          });
          continue;
        }

        const finalAssignTo = validatedGlobalAssignTo || lead.rowAssignTo || null;

        const result = await client.query(
          `INSERT INTO leads
             (name, phone, alternate_phone_number, source, budget,
              location_preference, project_id, project_name_text, status, configuration,
              assigned_to, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING *`,
          [
            lead.name,
            lead.phone,
            lead.alternate_phone,
            lead.source,
            lead.budget,
            lead.location_preference,
            lead.project_id,
            lead.project_name_text,
            lead.status,
            lead.configuration,
            finalAssignTo,
            createdBy,
          ]
        );

        const row = result.rows[0];
        inserted.push(row);

        // Activity log
        const actNote = finalAssignTo
          ? 'Lead created via bulk upload and assigned to user'
          : 'Lead created via bulk upload';
        await client.query(
          `INSERT INTO lead_activities (lead_id, type, note, performed_by)
           VALUES ($1, 'note', $2, $3)`,
          [row.id, actNote, createdBy]
        );

        // Reassignment history
        if (finalAssignTo) {
          await client.query(
            `INSERT INTO lead_reassignment_history
               (lead_id, from_user_id, to_user_id, reason, performed_by)
             VALUES ($1, NULL, $2, $3, $4)`,
            [row.id, finalAssignTo, 'Assigned during bulk upload', createdBy]
          );
        }
      } catch (err) {
        errors.push({ row: lead.rowNum, error: err.message });
      }
    }

    await client.query('COMMIT');
    fs.unlinkSync(req.file.path);

    // ── Result Excel ──────────────────────────────────────────────────────
    const resultWb  = new ExcelJS.Workbook();
    const summSheet = resultWb.addWorksheet('Upload Summary');

    summSheet.columns = [
      { header: 'Metric', key: 'metric', width: 32 },
      { header: 'Count',  key: 'count',  width: 12 },
    ];
    summSheet.getRow(1).font = { bold: true };
    summSheet.addRow({ metric: 'Total rows processed',    count: leads.length });
    summSheet.addRow({ metric: 'Successfully inserted',   count: inserted.length });
    summSheet.addRow({ metric: 'Skipped (duplicate phone)', count: skipped.length });
    summSheet.addRow({ metric: 'Errors (skipped)',        count: errors.length });
    summSheet.addRow({ metric: 'Assigned',                count: inserted.filter(l => l.assigned_to).length });
    summSheet.addRow({ metric: 'Unassigned',              count: inserted.filter(l => !l.assigned_to).length });

    if (errors.length) {
      const errSheet = resultWb.addWorksheet('Errors');
      errSheet.columns = [
        { header: 'Row',   key: 'row',   width: 10 },
        { header: 'Error', key: 'error', width: 60 },
      ];
      errSheet.getRow(1).font = { bold: true };
      errors.forEach(e => errSheet.addRow(e));
    }

    if (skipped.length) {
      const skipSheet = resultWb.addWorksheet('Skipped');
      skipSheet.columns = [
        { header: 'Row',    key: 'row',    width: 10 },
        { header: 'Phone',  key: 'phone',  width: 16 },
        { header: 'Reason', key: 'reason', width: 40 },
      ];
      skipSheet.getRow(1).font = { bold: true };
      skipped.forEach(s => skipSheet.addRow(s));
    }

    const resultDir = path.join(process.cwd(), 'uploads', 'leads', 'results');
    fs.mkdirSync(resultDir, { recursive: true });
    const resultFilename = `upload_result_${Date.now()}.xlsx`;
    await resultWb.xlsx.writeFile(path.join(resultDir, resultFilename));

    return sendSuccess(res, 'Bulk upload completed', {
      total:      leads.length,
      inserted:   inserted.length,
      skipped:    skipped.length,
      errors:     errors.length,
      resultFile: `/uploads/leads/results/${resultFilename}`,
      summary: {
        insertedLeads: inserted.map(l => ({
          id:            l.id,
          name:          l.name,
          phone:         l.phone,
          configuration: l.configuration,
          assigned_to:   l.assigned_to || null,
        })),
        errors:  errors.slice(0, 10),
        skipped: skipped.slice(0, 10),
      },
    }, 201);
  } catch (err) {
    await client.query('ROLLBACK');
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    next(err);
  } finally {
    client.release();
  }
};

// ─── GET /api/v1/leads/bulk/result/:filename ──────────────────────────────────
const downloadResultFile = async (req, res, next) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(process.cwd(), 'uploads', 'leads', 'results', filename);
    if (!fs.existsSync(filePath)) return next(new AppError('Result file not found', 404));
    res.download(filePath, filename, err => { if (err) next(err); });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/leads/bulk/delete
 * Body: { ids: [uuid, ...] }
 * Deletes multiple leads in one call. Admin / Super Admin only — bulk
 * deletion is high blast-radius, unlike the single-lead delete endpoint.
 */
const bulkDeleteLeads = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return next(new AppError('ids array is required and cannot be empty', 400));
    }

    const existing = await pool.query('SELECT id FROM leads WHERE id = ANY($1::uuid[])', [ids]);
    const foundIds = existing.rows.map(r => r.id);
    const notFoundIds = ids.filter(id => !foundIds.includes(id));

    if (foundIds.length) {
      await pool.query('DELETE FROM leads WHERE id = ANY($1::uuid[])', [foundIds]);
    }

    return sendSuccess(res, `${foundIds.length} lead(s) deleted`, {
      deleted_count: foundIds.length,
      deleted_ids: foundIds,
      not_found_ids: notFoundIds,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { downloadLeadTemplate, bulkUploadLeads, downloadResultFile, bulkDeleteLeads };