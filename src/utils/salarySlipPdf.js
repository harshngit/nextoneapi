/**
 * salarySlipPdf.js — Nextone Reality
 *
 * Renders a salary slip PDF using the Canva-designed background
 * (assets/templates/Pay Slip.png) with dynamic values overlaid on top.
 * The PNG is a flattened export (sample values are baked into the image),
 * so each dynamic field is first "erased" with a white rectangle before
 * the real value is written on top of it.
 */

const path = require('path');
const PDFDocument = require('pdfkit');

const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'assets', 'templates', 'Pay Slip.png');

// Template PNG is 1414 x 2000 px — the PDF page is built at that exact
// pixel size so these coordinates map 1:1 with the image.
const PAGE_WIDTH  = 1414;
const PAGE_HEIGHT = 2000;

const LABEL_VALUE_X = 390; // where "value" text starts, right after "Label :"
const INFO_FIELD_WIDTH = 550;
const INFO_FIELD_HEIGHT = 32;

const AMOUNT_COL_CENTER_X = 967;
const AMOUNT_COL_WIDTH = 280;

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Draws a white rectangle to cover the baked-in sample text, then writes
// the real value on top of it.
const eraseAndWrite = (doc, text, x, y, width, { align = 'left', size = 20, bold = false, height = INFO_FIELD_HEIGHT } = {}) => {
  doc.save();
  doc.rect(x - 4, y - 4, width, height).fill('#ffffff');
  doc.restore();
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor('#231f20');
  doc.text(text, x, y, { width, align });
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

  // ── Info block ────────────────────────────────────────────────────────────
  eraseAndWrite(doc, `${monthName} ${slip.year}`,      LABEL_VALUE_X, 470, INFO_FIELD_WIDTH);
  eraseAndWrite(doc, slip.employee_name || '—',         LABEL_VALUE_X, 505, INFO_FIELD_WIDTH);
  eraseAndWrite(doc, slip.employee_code || '—',         LABEL_VALUE_X, 540, INFO_FIELD_WIDTH);
  eraseAndWrite(doc, slip.role || '—',                  LABEL_VALUE_X, 575, INFO_FIELD_WIDTH);
  eraseAndWrite(doc, payDate,                           LABEL_VALUE_X, 610, INFO_FIELD_WIDTH);

  // ── Earnings table (amount column only — labels stay static) ───────────────
  eraseAndWrite(doc, money(basicSalary),   AMOUNT_COL_CENTER_X - AMOUNT_COL_WIDTH / 2, 975,  AMOUNT_COL_WIDTH, { align: 'center' });
  eraseAndWrite(doc, money(incentive),     AMOUNT_COL_CENTER_X - AMOUNT_COL_WIDTH / 2, 1030, AMOUNT_COL_WIDTH, { align: 'center' });
  eraseAndWrite(doc, money(totalEarnings), AMOUNT_COL_CENTER_X - AMOUNT_COL_WIDTH / 2, 1085, AMOUNT_COL_WIDTH, { align: 'center', bold: true });

  // ── Net Pay / Payment Mode ──────────────────────────────────────────────────
  eraseAndWrite(doc, money(netPay),               LABEL_VALUE_X, 1245, INFO_FIELD_WIDTH, { bold: true });
  eraseAndWrite(doc, slip.payment_mode || 'Bank Transfer', LABEL_VALUE_X, 1280, INFO_FIELD_WIDTH, { bold: true });

  doc.end();
};

module.exports = { renderSalarySlipPdf, TEMPLATE_PATH };
