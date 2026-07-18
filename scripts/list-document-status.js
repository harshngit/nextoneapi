/**
 * list-document-status.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Full readable report of every orphaned upload-backed row, split into:
 *   MATCHED — file still exists on disk somewhere, just at a different path
 *             (same thing reconcile-orphaned-documents.js finds/fixes)
 *   MISSING — no copy anywhere on disk, must be re-uploaded from the client/team
 *
 * Includes the project name (for project_documents) or lead name+phone (for
 * call_recordings / payment_proofs / lead_photos / closure_documents) so it's
 * immediately clear who to follow up with.
 *
 * Read-only — makes no changes. Usage:
 *   node scripts/list-document-status.js
 *   node scripts/list-document-status.js --project=<uuid>
 * ─────────────────────────────────────────────────────────────────────────────
 */

const path = require('path');
const fs = require('fs');
const { pool } = require('../src/config/db');

const projectArg = process.argv.find(a => a.startsWith('--project='));
const scopeProjectId = projectArg ? projectArg.split('=')[1] : null;

const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');

const resolvePath = (value, isAbsolute) =>
  isAbsolute ? value : path.join(process.cwd(), value);

const normalize = (name) => {
  if (!name) return '';
  const stripped = String(name).replace(/^\d{10,}_/, '');
  return stripped.toLowerCase().replace(/[^a-z0-9]/g, '');
};

function walk(dir, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results);
    else results.push(full);
  }
}

function buildFileIndex() {
  const files = [];
  walk(UPLOADS_ROOT, files);
  const index = new Map();
  for (const full of files) {
    const key = normalize(path.basename(full));
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(full);
  }
  return index;
}

// Each entry: table name, path column, absolute?, label column, extra SELECT
// columns + JOIN clause to bring in human-readable context.
const TABLES = [
  {
    name: 'project_documents',
    pathColumn: 'file_path',
    isAbsolute: true,
    labelColumn: 'file_name',
    contextSql: `SELECT d.id, d.file_path, d.file_name, d.document_type, d.uploaded_at AS created_at,
                        p.name AS context
                 FROM project_documents d
                 LEFT JOIN projects p ON p.id = d.project_id
                 ${scopeProjectId ? 'WHERE d.project_id = $1' : ''}`,
    params: scopeProjectId ? [scopeProjectId] : [],
  },
  {
    name: 'call_recordings',
    pathColumn: 'url',
    isAbsolute: false,
    labelColumn: 'name',
    contextSql: `SELECT c.id, c.url, c.name, c.created_at,
                        CONCAT(l.name, ' — ', l.phone) AS context
                 FROM call_recordings c
                 LEFT JOIN leads l ON l.id = c.lead_id`,
    params: [],
  },
  {
    name: 'payment_proofs',
    pathColumn: 'url',
    isAbsolute: false,
    labelColumn: 'name',
    contextSql: `SELECT pp.id, pp.url, pp.name, pp.created_at,
                        CONCAT(l.name, ' — ', l.phone) AS context
                 FROM payment_proofs pp
                 LEFT JOIN leads l ON l.id = pp.lead_id`,
    params: [],
  },
  {
    name: 'lead_photos',
    pathColumn: 'url',
    isAbsolute: false,
    labelColumn: 'name',
    contextSql: `SELECT lp.id, lp.url, lp.name, lp.created_at,
                        CONCAT(l.name, ' — ', l.phone) AS context
                 FROM lead_photos lp
                 LEFT JOIN leads l ON l.id = lp.lead_id`,
    params: [],
  },
  {
    name: 'closure_documents',
    pathColumn: 'url',
    isAbsolute: false,
    labelColumn: 'name',
    contextSql: `SELECT cd.id, cd.url, cd.name, cd.document_type, cd.created_at,
                        CONCAT(l.name, ' — ', l.phone) AS context
                 FROM closure_documents cd
                 LEFT JOIN lead_closures lc ON lc.id = cd.closure_id
                 LEFT JOIN leads l ON l.id = lc.lead_id`,
    params: [],
  },
];

async function main() {
  console.log(`\n=== Full document status report ===`);
  if (scopeProjectId) console.log(`Scoped to project_id = ${scopeProjectId}`);
  console.log(`Scanning ${UPLOADS_ROOT} ...`);

  const fileIndex = buildFileIndex();
  console.log(`Indexed ${[...fileIndex.values()].reduce((n, arr) => n + arr.length, 0)} physical file(s) under uploads/\n`);

  const matchedRows = [];
  const missingRows = [];

  for (const table of TABLES) {
    const { rows } = await pool.query(table.contextSql, table.params);

    for (const row of rows) {
      const rawPath = row[table.pathColumn];
      const existsAtRecordedPath = rawPath && fs.existsSync(resolvePath(rawPath, table.isAbsolute));
      if (existsAtRecordedPath) continue; // fine, not orphaned

      const key = normalize(row[table.labelColumn]);
      const candidates = fileIndex.get(key) || [];

      if (candidates.length >= 1) {
        matchedRows.push({ table: table.name, ...row, foundAt: candidates[0], multipleCandidates: candidates.length > 1 });
      } else {
        missingRows.push({ table: table.name, ...row });
      }
    }
  }

  console.log(`\n########## MATCHED — file exists elsewhere on disk (${matchedRows.length}) ##########\n`);
  for (const r of matchedRows) {
    console.log(`[${r.table}] ${r[r.labelColumn] || r.name || r.file_name || '(no name)'}`);
    console.log(`   id: ${r.id}`);
    console.log(`   belongs to: ${r.context || '(unknown)'}`);
    console.log(`   uploaded: ${r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : '(unknown)'}`);
    console.log(`   found at: ${r.foundAt}${r.multipleCandidates ? '  [multiple candidates — needs manual check]' : ''}`);
    console.log('');
  }

  console.log(`\n########## MISSING — no copy anywhere, must be re-uploaded (${missingRows.length}) ##########\n`);
  for (const r of missingRows) {
    console.log(`[${r.table}] ${r[r.labelColumn] || r.name || r.file_name || '(no name)'}`);
    console.log(`   id: ${r.id}`);
    console.log(`   belongs to: ${r.context || '(unknown)'}`);
    console.log(`   uploaded: ${r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : '(unknown)'}`);
    console.log('');
  }

  console.log(`=== Done — ${matchedRows.length} matched (recoverable via reconcile script), ${missingRows.length} truly missing ===\n`);
  await pool.end();
}

main().catch(err => {
  console.error('Report failed:', err);
  process.exit(1);
});
