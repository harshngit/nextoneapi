/**
 * reconcile-orphaned-documents.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Some "orphaned" rows (from audit-orphaned-documents.js) aren't actually gone —
 * the physical file is still sitting somewhere under uploads/, just at a
 * different path than the DB row expects (e.g. still in the temp/ staging
 * folder instead of wherever it was supposed to end up). This script walks the
 * ENTIRE uploads/ tree, matches loose files back to orphaned DB rows by name
 * (ignoring the multer timestamp prefix and punctuation differences), and
 * reports/fixes the DB path column to point at wherever the file really is.
 *
 * By default this is a DRY RUN — it only reports proposed fixes, it does not
 * change anything. Pass --fix to actually update the DB path columns.
 *
 * Usage:
 *   node scripts/reconcile-orphaned-documents.js                 # report only
 *   node scripts/reconcile-orphaned-documents.js --fix            # report + update DB
 *   node scripts/reconcile-orphaned-documents.js --project=<uuid> # scope to one project
 * ─────────────────────────────────────────────────────────────────────────────
 */

const path = require('path');
const fs = require('fs');
const { pool } = require('../src/config/db');

const FIX = process.argv.includes('--fix');
const projectArg = process.argv.find(a => a.startsWith('--project='));
const scopeProjectId = projectArg ? projectArg.split('=')[1] : null;

const UPLOADS_ROOT = path.join(process.cwd(), 'uploads');

const TABLES = [
  { name: 'project_documents', pathColumn: 'file_path', isAbsolute: true,  labelColumn: 'file_name', scopeColumn: 'project_id' },
  { name: 'call_recordings',   pathColumn: 'url',       isAbsolute: false, labelColumn: 'name',      scopeColumn: null },
  { name: 'payment_proofs',    pathColumn: 'url',       isAbsolute: false, labelColumn: 'name',      scopeColumn: null },
  { name: 'lead_photos',       pathColumn: 'url',       isAbsolute: false, labelColumn: 'name',      scopeColumn: null },
  { name: 'closure_documents', pathColumn: 'url',       isAbsolute: false, labelColumn: 'name',      scopeColumn: null },
];

const resolvePath = (value, isAbsolute) =>
  isAbsolute ? value : path.join(process.cwd(), value);

// Strips multer's "<timestamp>_" prefix, then lowercases and drops all
// non-alphanumeric characters so "1783420904545_Kalpataru_Vian_Plan.pdf" and
// "Kalpataru Vian Plan.pdf" normalize to the same key.
const normalize = (name) => {
  if (!name) return '';
  const stripped = String(name).replace(/^\d{10,}_/, '');
  return stripped.toLowerCase().replace(/[^a-z0-9]/g, '');
};

// ─── Build an index of every physical file under uploads/ ─────────────────────
function walk(dir, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return; // unreadable dir — skip
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
  const index = new Map(); // normalizedName -> [fullPath, ...]
  for (const full of files) {
    const key = normalize(path.basename(full));
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(full);
  }
  return index;
}

async function reconcileTable(table, fileIndex) {
  let query = `SELECT id, ${table.pathColumn}, ${table.labelColumn}${table.scopeColumn ? `, ${table.scopeColumn}` : ''} FROM ${table.name}`;
  const params = [];
  if (table.scopeColumn && scopeProjectId) {
    query += ` WHERE ${table.scopeColumn} = $1`;
    params.push(scopeProjectId);
  }

  const { rows } = await pool.query(query, params);
  const orphaned = rows.filter(r => {
    const raw = r[table.pathColumn];
    return !raw || !fs.existsSync(resolvePath(raw, table.isAbsolute));
  });

  let matched = 0, ambiguous = 0, unmatched = 0;

  for (const row of orphaned) {
    const key = normalize(row[table.labelColumn]);
    const candidates = fileIndex.get(key) || [];

    if (candidates.length === 1) {
      matched++;
      const foundPath = candidates[0];
      const newValue = table.isAbsolute
        ? foundPath
        : '/' + path.relative(process.cwd(), foundPath).replace(/\\/g, '/');

      console.log(`   [MATCH] ${row[table.labelColumn]}`);
      console.log(`           id: ${row.id}`);
      console.log(`           found at: ${foundPath}`);
      console.log(`           ${FIX ? 'updating' : 'would update'} ${table.pathColumn} → ${newValue}`);

      if (FIX) {
        await pool.query(`UPDATE ${table.name} SET ${table.pathColumn} = $1 WHERE id = $2`, [newValue, row.id]);
      }
    } else if (candidates.length > 1) {
      ambiguous++;
      console.log(`   [AMBIGUOUS] ${row[table.labelColumn]} (id: ${row.id}) — ${candidates.length} files match this name, skipping:`);
      candidates.forEach(c => console.log(`               ${c}`));
    } else {
      unmatched++;
    }
  }

  console.log(`\n-- ${table.name} — ${orphaned.length} orphaned, ${matched} matched, ${ambiguous} ambiguous, ${unmatched} truly missing`);
  return { matched, ambiguous, unmatched };
}

async function main() {
  console.log(`\n=== Orphaned document reconciliation ${FIX ? '(FIX MODE — updating DB)' : '(dry run — no changes)'} ===`);
  if (scopeProjectId) console.log(`Scoped to project_documents.project_id = ${scopeProjectId}`);
  console.log(`Scanning ${UPLOADS_ROOT} ...`);

  const fileIndex = buildFileIndex();
  console.log(`Indexed ${[...fileIndex.values()].reduce((n, arr) => n + arr.length, 0)} physical file(s) under uploads/\n`);

  let totalMatched = 0, totalAmbiguous = 0, totalUnmatched = 0;
  for (const table of TABLES) {
    const { matched, ambiguous, unmatched } = await reconcileTable(table, fileIndex);
    totalMatched += matched; totalAmbiguous += ambiguous; totalUnmatched += unmatched;
  }

  console.log(`\n=== Done — ${totalMatched} recovered${FIX ? '' : ' (rerun with --fix to apply)'}, ${totalAmbiguous} ambiguous (needs manual pick), ${totalUnmatched} truly missing (no file anywhere on disk) ===\n`);
  await pool.end();
}

main().catch(err => {
  console.error('Reconciliation failed:', err);
  process.exit(1);
});
