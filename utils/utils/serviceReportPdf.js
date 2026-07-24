const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const COMPANY = {
  name: 'DB Solar',
  subtitle: 'Solar Service Report Form',
  /** Optional — set COMPANY_ADDRESS in .env if you want an address line in the PDF header. */
  address: process.env.COMPANY_ADDRESS ? String(process.env.COMPANY_ADDRESS).trim() : '',
};

const LOGO_CANDIDATES = [
  path.join(__dirname, '..', 'assets', 'images', 'db_solar_company_logo.png'),
  path.join(__dirname, '..', '..', 'assets', 'images', 'db_solar_company_logo.png'),
];

const PAGE = { left: 36, right: 559, width: 523 };
const COLORS = {
  border: '#ced4da',
  headerBg: '#e9ecef',
  muted: '#6c757d',
  text: '#212529',
  legend: '#495057',
};

function resolveLogoPath() {
  for (const p of LOGO_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function esc(value) {
  if (value == null) return '';
  return String(value).trim();
}

function field(report, ...keys) {
  if (!report || typeof report !== 'object') return '';
  for (const key of keys) {
    if (report[key] != null && esc(report[key]) !== '') return esc(report[key]);
    const snake = key.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    if (report[snake] != null && esc(report[snake]) !== '') return esc(report[snake]);
  }
  return '';
}

function withUnit(value, unit) {
  const s = esc(value);
  if (!s) return '—';
  if (new RegExp(`\\b${unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(s)) return s;
  const num = s.replace(/[^\d.]/g, '');
  return num ? `${num} ${unit}` : s;
}

/** Strip (18 Nos) and similar from capacity strings; return numeric kW only. */
function capacityKwOnly(raw) {
  let s = esc(raw);
  if (!s) return '—';
  s = s.replace(/\s*\([^)]*\)/g, '').replace(/\s*\d+\s*nos\.?/gi, '').trim();
  const num = s.replace(/[^\d.]/g, '');
  if (num) return `${num} kW`;
  return s.replace(/\s*\([^)]*\)/g, '').trim() || '—';
}

function quantityNos(raw) {
  const s = esc(raw);
  if (!s) return '—';
  const fromParen = s.match(/\((\d+(?:\.\d+)?)\s*nos\.?\)/i);
  if (fromParen) return `${fromParen[1]} Nos.`;
  if (/\bnos\.?\b/i.test(s)) {
    const num = s.replace(/[^\d.]/g, '');
    return num ? `${num} Nos.` : s;
  }
  const num = s.replace(/[^\d.]/g, '');
  return num ? `${num} Nos.` : '—';
}

/** AC/DC readings: always apply Volt or Amp (ignore wrong Unit suffix from DB). */
function readingWithUnit(value, unitLabel) {
  const s = esc(value);
  if (!s) return '—';
  const num = s.replace(/[^\d.]/g, '');
  if (!num) return s;
  return `${num} ${unitLabel}`;
}

function tryParseJsonArray(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw;
  const s = esc(raw);
  if (!s) return null;
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
  } catch (_) {}
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
  }
  if (s.includes(',')) return s.split(',').map((v) => v.trim());
  return [s];
}

function normalizeDcRow(r) {
  if (r == null) return null;
  if (typeof r !== 'object') {
    return { mppt: esc(r), string: '', voltage: '', current: '' };
  }
  return {
    mppt: esc(r.mppt ?? r.MPPT ?? r.dc_mppt ?? r.dcMppt ?? r.dc_mpp ?? r.dcMpp),
    string: esc(
      r.string ??
        r.String ??
        r.dc_string ??
        r.dcString ??
        r.string_no ??
        r.stringNo ??
        r.dc_string_no
    ),
    voltage: esc(r.voltage ?? r.Voltage ?? r.dc_voltage ?? r.dcVoltage),
    current: esc(r.current ?? r.Current ?? r.dc_current ?? r.dcCurrent),
  };
}

function parseDcRows(report) {
  if (!report || typeof report !== 'object') return [];

  for (const val of Object.values(report)) {
    if (typeof val !== 'string' || !val.trim().startsWith('[')) continue;
    try {
      const parsed = JSON.parse(val);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        typeof parsed[0] === 'object' &&
        parsed[0] != null
      ) {
        const normalized = parsed.map(normalizeDcRow).filter(Boolean).filter(hasDcData);
        if (normalized.length > 0) return normalized;
      }
    } catch (_) {}
  }

  if (Array.isArray(report.dcRows)) {
    return report.dcRows.map(normalizeDcRow).filter(Boolean).filter(hasDcData);
  }
  if (Array.isArray(report.dc_rows)) {
    return report.dc_rows.map(normalizeDcRow).filter(Boolean).filter(hasDcData);
  }

  for (const key of ['dcData', 'dc_data', 'dcSide', 'dc_side', 'dcDetails', 'dc_details']) {
    const raw = report[key] ?? report[key.replace(/([A-Z])/g, '_$1').toLowerCase()];
    if (raw == null) continue;
    if (Array.isArray(raw)) {
      return raw.map(normalizeDcRow).filter(Boolean).filter(hasDcData);
    }
    const s = esc(raw);
    if (!s) continue;
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeDcRow).filter(Boolean).filter(hasDcData);
      }
    } catch (_) {}
  }

  const mppts = tryParseJsonArray(report.dcMppt ?? report.dc_mppt);
  const strings = tryParseJsonArray(report.dcString ?? report.dc_string);
  const volts = tryParseJsonArray(report.dcVoltage ?? report.dc_voltage);
  const currs = tryParseJsonArray(report.dcCurrent ?? report.dc_current);

  if (mppts || strings || volts || currs) {
    const len = Math.max(
      mppts?.length ?? 0,
      strings?.length ?? 0,
      volts?.length ?? 0,
      currs?.length ?? 0
    );
    if (len > 0) {
      const rows = [];
      for (let i = 0; i < len; i++) {
        rows.push(
          normalizeDcRow({
            mppt: mppts?.[i],
            string: strings?.[i],
            voltage: volts?.[i],
            current: currs?.[i],
          })
        );
      }
      return rows.filter(Boolean).filter(hasDcData);
    }
  }

  const byIndex = new Map();
  for (const [key, val] of Object.entries(report)) {
    if (val == null || esc(val) === '') continue;
    const k = key.toLowerCase();
    const match =
      k.match(/^dc_?mppt_?(\d+)$/) ||
      k.match(/^dc_?string_?(\d+)$/) ||
      k.match(/^dc_?voltage_?(\d+)$/) ||
      k.match(/^dc_?current_?(\d+)$/);
    if (!match) continue;
    const idx = parseInt(match[1], 10);
    if (!byIndex.has(idx)) byIndex.set(idx, {});
    const row = byIndex.get(idx);
    if (k.includes('mppt')) row.mppt = esc(val);
    else if (k.includes('string')) row.string = esc(val);
    else if (k.includes('voltage')) row.voltage = esc(val);
    else if (k.includes('current')) row.current = esc(val);
  }
  if (byIndex.size > 0) {
    return [...byIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, row]) => normalizeDcRow(row))
      .filter(Boolean)
      .filter(hasDcData);
  }

  const singleRow = normalizeDcRow({
    mppt: field(report, 'dcMppt', 'dc_mppt'),
    string: field(report, 'dcString', 'dc_string'),
    voltage: field(report, 'dcVoltage', 'dc_voltage'),
    current: field(report, 'dcCurrent', 'dc_current'),
  });
  if (hasDcData(singleRow)) {
    return [singleRow];
  }

  const rows = [];
  for (let i = 0; i < 24; i++) {
    const mppt = field(report, `dcMppt${i}`, `dc_mppt_${i}`, `dc_mppt${i}`);
    const str = field(report, `dcString${i}`, `dc_string_${i}`, `dc_string${i}`);
    const volt = field(report, `dcVoltage${i}`, `dc_voltage_${i}`, `dc_voltage${i}`);
    const curr = field(report, `dcCurrent${i}`, `dc_current_${i}`, `dc_current${i}`);
    if (mppt || str || volt || curr) {
      rows.push(normalizeDcRow({ mppt, string: str, voltage: volt, current: curr }));
    }
  }
  return rows.filter(Boolean).filter(hasDcData);
}

function hasDcData(row) {
  return !!(row && (row.mppt || row.string || row.voltage || row.current));
}

function acVoltageCell(report, ...keys) {
  return readingWithUnit(field(report, ...keys), 'Volt');
}

function acCurrentCell(report, ...keys) {
  return readingWithUnit(field(report, ...keys), 'Amp');
}

function dcVoltageCell(value) {
  return readingWithUnit(value, 'Volt');
}

function dcCurrentCell(value) {
  return readingWithUnit(value, 'Amp');
}

function phaseLabel(report) {
  const p = field(report, 'phaseType', 'phase_type').toLowerCase();
  if (p.includes('three') || p === '3' || p.includes('3 phase')) return 'Three Phase';
  return 'Single Phase';
}

function isSinglePhase(report) {
  const p = field(report, 'phaseType', 'phase_type').toLowerCase();
  return !(p.includes('three') || p === '3' || p.includes('3 phase'));
}

function remarksText(report) {
  const direct = field(report, 'remarksText', 'remarks_text', 'remark', 'selectedRemarks');
  if (direct) return direct;
  const ids = report.selectedRemarkIds ?? report.selected_remark_ids;
  if (Array.isArray(ids) && ids.length) return ids.join(', ');
  return field(report, 'newRemark', 'new_remark');
}

function formatDateDisplay(raw) {
  const s = esc(raw);
  if (!s) return '—';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  return s;
}

function formatTimeDisplay(raw) {
  const s = esc(raw);
  if (!s) return '—';
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function enggIdDisplay(report, engineer) {
  const raw = field(report, 'enggId', 'engg_id');
  if (raw) return raw.toUpperCase().startsWith('DB /') ? raw : `DB / ${raw}`;
  if (engineer?.employeeId) return `DB / ${engineer.employeeId}`;
  return '—';
}

function ensureSpace(doc, y, needed, ctx) {
  if (y + needed <= ctx.pageBottom) return y;
  doc.addPage();
  ctx.pageNum += 1;
  return drawPageHeader(doc, ctx);
}

function drawPageHeader(doc, ctx) {
  let y = PAGE.left;
  const logoPath = ctx.logoPath;

  if (logoPath) {
    try {
      doc.image(logoPath, PAGE.left, y, { width: 52, height: 52 });
    } catch (_) {}
  }

  doc
    .fillColor(COLORS.text)
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(COMPANY.name, PAGE.left + 62, y + 2);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.muted)
    .text(COMPANY.subtitle, PAGE.left + 62, y + 18);

  let textY = y + 30;
  if (COMPANY.address) {
    doc
      .fontSize(8)
      .text(COMPANY.address, PAGE.left + 62, textY, { width: 240 });
    textY += 12;
  }

  doc
    .fontSize(8)
    .text(`Service No: SRV / ${ctx.serviceId}`, PAGE.left + 62, textY);

  const dateLabel = formatDateDisplay(ctx.reportDate);
  const timeLabel = formatTimeDisplay(ctx.reportTime);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text('Date', PAGE.right - 150, y + 2, { width: 70, align: 'left' })
    .text('Time', PAGE.right - 70, y + 2, { width: 70, align: 'left' });
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(COLORS.text)
    .text(dateLabel, PAGE.right - 150, y + 14, { width: 70 })
    .text(timeLabel, PAGE.right - 70, y + 14, { width: 70 });

  y += 62;
  doc
    .moveTo(PAGE.left, y)
    .lineTo(PAGE.right, y)
    .strokeColor(COLORS.border)
    .stroke();
  return y + 12;
}

function drawFieldset(doc, y, title, contentHeight, drawFn, ctx, options = {}) {
  const tableOnly = options.tableOnly === true;
  y = ensureSpace(doc, y, contentHeight + (tableOnly ? 20 : 28), ctx);

  const titleY = tableOnly ? y + 6 : y - 2;
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(COLORS.legend)
    .text(title, PAGE.left + 8, titleY, { lineBreak: false });

  const boxTop = tableOnly ? titleY + 10 : y + 8;
  const endY = drawFn(boxTop + (tableOnly ? 0 : 4));
  if (!tableOnly) {
    doc
      .roundedRect(PAGE.left, boxTop, PAGE.width, endY - boxTop + 4, 3)
      .strokeColor(COLORS.border)
      .stroke();
  }
  return endY + (tableOnly ? 14 : 10);
}

function drawLabelRow(doc, y, items, ctx) {
  const colW = PAGE.width / items.length;
  items.forEach((item, i) => {
    const x = PAGE.left + i * colW;
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted).text(item.label, x + 4, y, { width: colW - 8 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text).text(item.value || '—', x + 4, y + 11, {
      width: colW - 8,
    });
  });
  return y + 32;
}

function drawTable(doc, y, colWidths, headers, rows, ctx) {
  const rowH = 20;
  const headerH = 22;
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const dataRows = rows.length ? rows : [headers.map(() => '—')];
  const tableH = headerH + dataRows.length * rowH;
  y = ensureSpace(doc, y, tableH, ctx);

  const left = PAGE.left;
  const right = left + totalW;
  const top = y;
  const bottom = top + tableH;

  doc.rect(left, top, totalW, headerH).fill(COLORS.headerBg);

  doc.save();
  doc.lineWidth(1).strokeColor(COLORS.border);
  doc.rect(left, top, totalW, tableH).stroke();

  let x = left;
  for (let i = 0; i < colWidths.length - 1; i++) {
    x += colWidths[i];
    doc.moveTo(x, top).lineTo(x, bottom).stroke();
  }

  doc.moveTo(left, top + headerH).lineTo(right, top + headerH).stroke();

  let cy = top + headerH;
  for (let rowIdx = 1; rowIdx < dataRows.length; rowIdx++) {
    cy += rowH;
    doc.moveTo(left, cy).lineTo(right, cy).stroke();
  }
  doc.restore();

  x = left;
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(8);
  headers.forEach((h, i) => {
    doc.text(h, x + 3, top + 6, { width: colWidths[i] - 6, align: 'center' });
    x += colWidths[i];
  });

  cy = top + headerH;
  dataRows.forEach((row) => {
    x = left;
    row.forEach((cell, i) => {
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.text).text(cell || '—', x + 3, cy + 6, {
        width: colWidths[i] - 6,
        align: 'center',
      });
      x += colWidths[i];
    });
    cy += rowH;
  });

  return bottom;
}

function buildServiceReportPdf(payload) {
  return new Promise((resolve, reject) => {
    try {
      const { report = {}, serviceRequest = {}, engineer = null } = payload;
      const serviceId = serviceRequest.id ?? report.serviceRequestId ?? '—';
      const reportDate = field(report, 'reportDate', 'report_date');
      const reportTime = field(report, 'reportTime', 'report_time');

      const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const ctx = {
        logoPath: resolveLogoPath(),
        serviceId,
        reportDate,
        reportTime,
        pageBottom: 832,
        pageNum: 1,
      };

      let y = drawPageHeader(doc, ctx);

      y = drawFieldset(
        doc,
        y,
        'Consumer Details',
        36,
        (innerY) => {
          return drawLabelRow(
            doc,
            innerY,
            [
              { label: 'Name', value: field(report, 'consumerName', 'consumer_name') },
              { label: 'Address', value: field(report, 'consumerAddress', 'consumer_address') },
              { label: 'Phone', value: field(report, 'consumerPhone', 'consumer_phone') },
            ],
            ctx
          );
        },
        ctx
      );

      y = drawFieldset(
        doc,
        y,
        'Project Details',
        120,
        (innerY) => {
          let cy = drawLabelRow(
            doc,
            innerY,
            [
              { label: 'Plant Capacity', value: withUnit(field(report, 'plantCapacity', 'plant_capacity'), 'kW') },
              { label: 'Load Sanction', value: withUnit(field(report, 'loadSanction', 'load_sanction'), 'kW') },
              { label: 'Phase', value: phaseLabel(report) },
            ],
            ctx
          );
          cy = drawLabelRow(
            doc,
            cy,
            [
              { label: 'Solar Module Make', value: field(report, 'solarModuleMake', 'solar_module_make') },
              {
                label: 'Solar Capacity',
                value: capacityKwOnly(field(report, 'solarModuleCapacity', 'solar_module_capacity')),
              },
              {
                label: 'Solar Panel Quantity',
                value: quantityNos(field(report, 'solarModuleQuantity', 'solar_module_quantity')),
              },
            ],
            ctx
          );
          cy = drawLabelRow(
            doc,
            cy,
            [
              { label: 'Inverter Make', value: field(report, 'inverterMake', 'inverter_make') },
              {
                label: 'Inverter Capacity',
                value: capacityKwOnly(field(report, 'inverterCapacity', 'inverter_capacity')),
              },
              {
                label: 'Inverter Quantity',
                value: quantityNos(field(report, 'inverterQuantity', 'inverter_quantity')),
              },
              {
                label: 'Inverter Serial No.',
                value: field(report, 'inverterSerialNo', 'inverter_serial_no'),
              },
            ],
            ctx
          );
          return cy;
        },
        ctx
      );

      y = drawFieldset(
        doc,
        y,
        'AC Side Details',
        60,
        (innerY) => {
          const single = isSinglePhase(report);
          const headers = ['Phase', 'Voltage', 'Current'];
          const colWidths = [120, 200, 203];
          const rows = single
            ? [
                [
                  'Single',
                  acVoltageCell(report, 'acVoltageRn', 'ac_voltage_rn'),
                  acCurrentCell(report, 'acCurrentR', 'ac_current_r'),
                ],
              ]
            : [
                [
                  'R-N',
                  acVoltageCell(report, 'acVoltageRn', 'ac_voltage_rn'),
                  acCurrentCell(report, 'acCurrentR', 'ac_current_r'),
                ],
                [
                  'Y-N',
                  acVoltageCell(report, 'acVoltageYn', 'ac_voltage_yn'),
                  acCurrentCell(report, 'acCurrentY', 'ac_current_y'),
                ],
                [
                  'B-N',
                  acVoltageCell(report, 'acVoltageBn', 'ac_voltage_bn'),
                  acCurrentCell(report, 'acCurrentB', 'ac_current_b'),
                ],
              ];
          return drawTable(doc, innerY, colWidths, headers, rows, ctx);
        },
        ctx,
        { tableOnly: true }
      );

      const dcRows = parseDcRows(report);
      y = drawFieldset(
        doc,
        y,
        'DC Side',
        40 + Math.max(dcRows.length, 1) * 20,
        (innerY) => {
          const headers = ['MPPT', 'String', 'Voltage', 'Current'];
          const colWidths = [100, 120, 150, 153];
          const rows = dcRows.map((r) => [
            r.mppt || '—',
            r.string || '—',
            dcVoltageCell(r.voltage),
            dcCurrentCell(r.current),
          ]);
          return drawTable(doc, innerY, colWidths, headers, rows, ctx);
        },
        ctx,
        { tableOnly: true }
      );

      y = drawFieldset(
        doc,
        y,
        'ACDB Box',
        44,
        (innerY) => {
          const headers = ['PN', 'NE', 'PE'];
          const colWidths = [174, 174, 175];
          const rows = [
            [
              readingWithUnit(field(report, 'acdbPn', 'acdb_pn'), 'Volt'),
              readingWithUnit(field(report, 'acdbNe', 'acdb_ne'), 'Volt'),
              readingWithUnit(field(report, 'acdbPn2', 'acdb_pn2'), 'Volt'),
            ],
          ];
          return drawTable(doc, innerY, colWidths, headers, rows, ctx);
        },
        ctx,
        { tableOnly: true }
      );

      y = drawFieldset(
        doc,
        y,
        'Generation',
        44,
        (innerY) => {
          const headers = ['Today', 'Yesterday', 'Monthly', 'Yearly'];
          const colWidths = [130, 130, 130, 133];
          const rows = [
            [
              withUnit(field(report, 'generationToday', 'generation_today'), 'Unit'),
              withUnit(field(report, 'generationYesterday', 'generation_yesterday'), 'Unit'),
              withUnit(field(report, 'generationMonthly', 'generation_monthly'), 'Unit'),
              withUnit(field(report, 'generationYearly', 'generation_yearly'), 'Unit'),
            ],
          ];
          return drawTable(doc, innerY, colWidths, headers, rows, ctx);
        },
        ctx,
        { tableOnly: true }
      );

      y = drawFieldset(
        doc,
        y,
        'Import & Export Details',
        44,
        (innerY) => {
          const headers = ['Import', 'Export', 'Generation Meter'];
          const colWidths = [174, 174, 175];
          const rows = [
            [
              withUnit(field(report, 'importUnits', 'import_units'), 'Unit'),
              withUnit(field(report, 'exportUnits', 'export_units'), 'Unit'),
              withUnit(field(report, 'meterGenerationUnits', 'meter_generation_units'), 'Unit'),
            ],
          ];
          return drawTable(doc, innerY, colWidths, headers, rows, ctx);
        },
        ctx,
        { tableOnly: true }
      );

      y = drawFieldset(
        doc,
        y,
        'Remark',
        40,
        (innerY) => {
          const text = remarksText(report) || '—';
          doc.font('Helvetica').fontSize(9).fillColor(COLORS.text).text(text, PAGE.left + 6, innerY, {
            width: PAGE.width - 12,
          });
          return innerY + 24;
        },
        ctx
      );

      const engName =
        field(report, 'enggSignName', 'engg_sign_name') ||
        [engineer?.firstName, engineer?.lastName].filter(Boolean).join(' ') ||
        engineer?.fullName ||
        '—';

      y = drawFieldset(
        doc,
        y,
        'Signatures',
        36,
        (innerY) =>
          drawLabelRow(
            doc,
            innerY,
            [
              {
                label: 'Consumer Sign & Name',
                value: field(report, 'consumerSignName', 'consumer_sign_name'),
              },
              { label: 'Engg Name', value: engName },
              { label: 'Engg ID', value: enggIdDisplay(report, engineer) },
              {
                label: 'Date',
                value: formatDateDisplay(
                  field(report, 'enggSignDate', 'engg_sign_date') || reportDate
                ),
              },
            ],
            ctx
          ),
        ctx
      );

      if (serviceRequest.status || serviceRequest.serviceType || serviceRequest.warrantyType) {
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(COLORS.muted)
          .text(
            [
              serviceRequest.status ? `Status: ${serviceRequest.status}` : null,
              serviceRequest.serviceType || serviceRequest.message
                ? `Service: ${serviceRequest.serviceType || serviceRequest.message}`
                : null,
              serviceRequest.warrantyType ? `Warranty: ${serviceRequest.warrantyType}` : null,
            ]
              .filter(Boolean)
              .join('   |   '),
            PAGE.left,
            y,
            { width: PAGE.width, align: 'center' }
          );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { buildServiceReportPdf };
