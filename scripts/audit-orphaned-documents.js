/**
 * audit-orphaned-documents.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Finds DB rows across every upload-backed table (project_documents,
 * call_recordings, payment_proofs, lead_photos, closure_documents) whose
 * physical file is missing from disk — these are what return 404 on
 * download even though the API "advertises" them in list responses.
 *
 * By default this is a DRY RUN — it only reports orphaned rows, it does not
 * delete anything. Pass --delete to actually remove the orphaned rows.
 *
 * Usage:
 *   node scripts/audit-orphaned-documents.js                 # report only
 *   node scripts/audit-orphaned-documents.js --delete         # report + delete
 *   node scripts/audit-orphaned-documents.js --project=<uuid> # scope to one project
 * ─────────────────────────────────────────────────────────────────────────────
 */

const path = require('path');
const fs = require('fs');
const { pool } = require('../src/config/db');

const DELETE = process.argv.includes('--delete');
const projectArg = process.argv.find(a => a.startsWith('--project='));
const scopeProjectId = projectArg ? projectArg.split('=')[1] : null;

// Tables whose "url" column is a relative path like /uploads/xxx — resolved
// against process.cwd(). project_documents stores an absolute file_path instead.
const TABLES = [
  {
    name: 'project_documents',
    pathColumn: 'file_path',
    isAbsolute: true,
    labelColumn: 'file_name',
    scopeColumn: 'project_id',
  },
  { name: 'call_recordings',  pathColumn: 'url', isAbsolute: false, labelColumn: 'name', scopeColumn: null },
  { name: 'payment_proofs',   pathColumn: 'url', isAbsolute: false, labelColumn: 'name', scopeColumn: null },
  { name: 'lead_photos',      pathColumn: 'url', isAbsolute: false, labelColumn: 'name', scopeColumn: null },
  { name: 'closure_documents',pathColumn: 'url', isAbsolute: false, labelColumn: 'name', scopeColumn: null },
];

const resolvePath = (value, isAbsolute) =>
  isAbsolute ? value : path.join(process.cwd(), value);

async function auditTable(table) {
  let query = `SELECT id, ${table.pathColumn}, ${table.labelColumn}${table.scopeColumn ? `, ${table.scopeColumn}` : ''} FROM ${table.name}`;
  const params = [];
  if (table.scopeColumn && scopeProjectId) {
    query += ` WHERE ${table.scopeColumn} = $1`;
    params.push(scopeProjectId);
  }

  const { rows } = await pool.query(query, params);
  const orphaned = rows.filter(r => {
    const raw = r[table.pathColumn];
    if (!raw) return true; // no path at all — definitely orphaned
    return !fs.existsSync(resolvePath(raw, table.isAbsolute));
  });

  return { table: table.name, total: rows.length, orphaned };
}

async function main() {
  console.log(`\n=== Orphaned document audit ${DELETE ? '(DELETE MODE)' : '(dry run — no changes)'} ===`);
  if (scopeProjectId) console.log(`Scoped to project_documents.project_id = ${scopeProjectId}\n`);

  let grandTotalOrphaned = 0;

  for (const table of TABLES) {
    const { total, orphaned } = await auditTable(table);
    console.log(`\n-- ${table.name} — ${total} row(s) total, ${orphaned.length} orphaned`);
    for (const row of orphaned) {
      console.log(`   [${row.id}] ${row[table.labelColumn] || '(no name)'} — missing file`);
    }
    grandTotalOrphaned += orphaned.length;

    if (DELETE && orphaned.length > 0) {
      const ids = orphaned.map(r => r.id);
      await pool.query(`DELETE FROM ${table.name} WHERE id = ANY($1::uuid[])`, [ids]);
      console.log(`   → deleted ${ids.length} orphaned row(s) from ${table.name}`);
    }
  }

  console.log(`\n=== Done — ${grandTotalOrphaned} orphaned row(s) found across all tables${DELETE ? ' (deleted)' : ' (not deleted — rerun with --delete to remove)'} ===\n`);
  await pool.end();
}

main().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
