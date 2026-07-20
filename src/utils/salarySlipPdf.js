/**
 * salarySlipPdf.js — Nextone Reality
 *
 * Renders a salary slip PDF using the Canva-designed background
 * (assets/templates/Salary Slip.png) with dynamic values overlaid on top.
 * The PNG is a flattened export — some fields have sample values baked
 * into the image (e.g. the employee name, the amount figures), so those
 * are first "erased" with a white rectangle sized to the WHOLE field/cell
 * (not just the new text) before the real value is written on top —
 * this guarantees the old baked-in value can never peek through.
 * Month / Position / Pay Date are blank in this template, so those are
 * written directly with no erase step.
 *
 * Coordinates below were measured directly against the source PNG
 * (4419 x 6250 px) using a pixel grid overlay, not eyeballed from a
 * downscaled preview — see scratchpad grid images from the coordinate
 * calibration pass if these ever need re-measuring.
 */

const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'assets', 'templates', 'Salary Slip.png');

// Source PNG dimensions — the PDF page is built at this exact pixel size.
const PAGE_WIDTH  = 4419;
const PAGE_HEIGHT = 6250;

const money = (n) => `${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} rs`;

// auth_signature_url is stored as a full public URL — pdfkit needs the
// real local file path instead.
const urlToLocalPath = (url) => {
  if (!url) return null;
  const marker = '/uploads/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return path.join(process.cwd(), url.slice(idx));
};

const eraseZone = (doc, { x, y, w, h }) => {
  doc.save();
  doc.rect(x, y, w, h).fill('#ffffff');
  doc.restore();
};

const writeText = (doc, text, { x, y, w }, { align = 'left', size = 60, bold = false } = {}) => {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor('#231f20');
  doc.text(text, x, y, { width: w, align });
};

/**
 * Generates a salary slip PDF for one slip and pipes it directly to the
 * given writable stream (typically the Express `res` object).
 *
 * @param {object} slip - a row from salary_slips, plus employee_name/role
 * @param {import('stream').Writable} outputStream
 */
const renderSalarySlipPdf = (slip, outputStream) => {
  const doc = new PDFDocument({ size: [PAGE_WIDTH, PAGE_HEIGHT], margin: 0 });
  doc.pipe(outputStream);

  doc.image(TEMPLATE_PATH, 0, 0, { width: PAGE_WIDTH, height: PAGE_HEIGHT });

  const monthName = new Date(slip.year, slip.month - 1).toLocaleString('en-US', { month: 'long' });
  const payDate = slip.pay_date
    ? new Date(slip.pay_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

  const basicSalary = parseFloat(slip.monthly_salary) || 0;
  const incentive   = parseFloat(slip.incentive_amount) || 0;
  const totalEarnings = basicSalary + incentive;
  const netPay = slip.total_payout !== undefined && slip.total_payout !== null
    ? parseFloat(slip.total_payout)
    : totalEarnings - (parseFloat(slip.deductions) || 0);

  // ── Employee name — baked-in sample ("Rachel Akinwale"), needs erase ───────
  eraseZone(doc, { x: 430, y: 1385, w: 1900, h: 215 });
  writeText(doc, slip.employee_name || '—', { x: 470, y: 1410, w: 1800 }, { size: 130, bold: true });

  // ── Month / Position / Pay Date — blank in template, no erase needed ───────
  writeText(doc, `${monthName} ${slip.year}`, { x: 1030, y: 1660, w: 1350 }, { size: 78 });
  writeText(doc, slip.role || '—',            { x: 1030, y: 1798, w: 1350 }, { size: 78 });
  writeText(doc, payDate,                     { x: 1030, y: 1936, w: 1350 }, { size: 78 });

  // ── Earnings table amount column — erase the cell interior only, kept well
  // clear of the table borders/divider (rows: header-bottom 3033, divider
  // 3517, table-bottom 4001) so no border line gets painted over ──────────
  eraseZone(doc, { x: 2630, y: 3075, w: 1330, h: 395 }); // Basic Salary cell
  writeText(doc, money(basicSalary), { x: 2660, y: 3225, w: 1300 }, { size: 95 });

  eraseZone(doc, { x: 2630, y: 3560, w: 1330, h: 395 }); // Incentives cell
  writeText(doc, money(incentive),   { x: 2660, y: 3709, w: 1300 }, { size: 95 });

  // ── Total Earnings (bottom, large bold — baked-in sample) ──────────────────
  // Width kept under ~3070 so it doesn't touch the "Thank You" panel's left edge.
  eraseZone(doc, { x: 1895, y: 5340, w: 1150, h: 260 });
  writeText(doc, money(netPay), { x: 1918, y: 5400, w: 1100 }, { size: 130, bold: true });

  // ── Authorized signature (optional) — blank space above the
  // "Santosh Kanojiya / Founder" line ─────────────────────────────────────────
  const signaturePath = urlToLocalPath(slip.auth_signature_url);
  if (signaturePath && fs.existsSync(signaturePath)) {
    try {
      doc.image(signaturePath, 442, 5050, { fit: [900, 380], align: 'left' });
    } catch (e) {
      // Corrupt/unreadable signature file — skip it rather than fail the whole PDF.
    }
  }

  doc.end();
};

module.exports = { renderSalarySlipPdf, TEMPLATE_PATH };
