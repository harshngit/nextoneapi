/**
 * salarySlipPdf.js — Nextone Reality
 *
 * Renders a salary slip PDF using the Canva-designed background
 * (assets/templates/Salary Slip.png) with dynamic values overlaid on top.
 * The PNG is a flattened export — some fields have sample values baked
 * into the image (e.g. the employee name, the amount figures), so those
 * are first "erased" with a white rectangle before the real value is
 * written on top. Month / Position / Pay Date are blank in this template,
 * so those are written directly with no erase step.
 */

const path = require('path');
const PDFDocument = require('pdfkit');

const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'assets', 'templates', 'Salary Slip.png');

// Source PNG is 4419 x 6250 px — the PDF page is built at that exact pixel
// size. Coordinates below are authored in the 1414 x 2000 preview space
// (what a human reviews) and scaled up by this factor to match the source.
const SCALE = 3.13;
const PAGE_WIDTH  = 4419;
const PAGE_HEIGHT = 6250;

const s = (n) => n * SCALE; // scale a single value
const box = (x, y, w, h) => ({ x: s(x), y: s(y), w: s(w), h: s(h) });

const money = (n) => `${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} rs`;

// Draws a white rectangle to cover baked-in sample text, then writes the
// real value on top of it. Skip the erase step for fields that are blank
// in the template (pass erase: false).
const writeField = (doc, text, { x, y, w, h }, { align = 'left', size = 20, bold = false, erase = true } = {}) => {
  if (erase) {
    doc.save();
    doc.rect(x - s(4), y - s(4), w, h).fill('#ffffff');
    doc.restore();
  }
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(s(size)).fillColor('#231f20');
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

  // ── Employee name (bold, baked-in sample — needs erase) ────────────────────
  writeField(doc, slip.employee_name || '—', box(143, 448, 500, 55), { size: 34, bold: true });

  // ── Month / Position / Pay Date — blank in template, no erase needed ───────
  writeField(doc, `${monthName} ${slip.year}`, box(300, 533, 350, 26), { size: 20, erase: false });
  writeField(doc, slip.role || '—',            box(300, 568, 350, 26), { size: 20, erase: false });
  writeField(doc, payDate,                     box(300, 603, 350, 26), { size: 20, erase: false });

  // ── Earnings table amount column (labels stay static) ───────────────────────
  writeField(doc, money(basicSalary), box(875, 1010, 210, 40), { size: 22 });
  writeField(doc, money(incentive),   box(875, 1163, 210, 40), { size: 22 });

  // ── Total Earnings (bottom, large bold — baked-in sample) ──────────────────
  writeField(doc, money(netPay), box(617, 1848, 320, 60), { size: 36, bold: true });

  doc.end();
};

module.exports = { renderSalarySlipPdf, TEMPLATE_PATH };
