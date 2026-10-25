const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// Build a per-batch lookup: grid[day][period] = entry (for the first period of its span)
function batchGrids(rows, batches) {
  const names = [...new Set(rows.map((r) => r.batch))];
  return (batches || names.map((n) => ({ name: n }))).filter((b) => names.includes(b.name)).map((b) => ({
    name: b.name,
    rows: rows.filter((r) => r.batch === b.name),
  }));
}

const labelOf = (e) => (e.type === 'lab' && !/lab/i.test(e.subject) ? `${e.subject} (Lab)` : e.subject);

function cellText(e) {
  return `${labelOf(e)}\n${e.teacher}\n${e.room}`;
}

async function toXlsx(tt) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smart Timetable Generator';
  const { settings, slots } = tt;
  const L = settings.lunch_after;

  for (const g of batchGrids(tt.timetable)) {
    const ws = wb.addWorksheet(g.name.replace(/[\\/?*[\]:]/g, '-').slice(0, 31));
    ws.columns = [{ width: 18 }, ...settings.days.map(() => ({ width: 24 }))];
    const head = ws.addRow(['Time', ...settings.days]);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }; c.alignment = { horizontal: 'center' }; });

    const rowOf = {}; // period -> excel row number
    for (const s of slots) {
      const r = ws.addRow([`P${s.period}  ${s.start}-${s.end}`]);
      r.height = 48;
      rowOf[s.period] = r.number;
      if (s.period === L && L < slots.length) {
        const lr = ws.addRow(['Lunch Break']);
        ws.mergeCells(lr.number, 1, lr.number, settings.days.length + 1);
        lr.alignment = { horizontal: 'center' };
        lr.font = { italic: true, color: { argb: 'FF64748B' } };
      }
    }
    ws.eachRow((row, n) => { if (n > 1) row.getCell(1).font = { bold: true }; });
    for (const e of g.rows) {
      const col = settings.days.indexOf(e.day) + 2;
      if (col < 2) continue;
      const top = rowOf[e.period];
      const cell = ws.getCell(top, col);
      cell.value = cellText(e);
      if (e.span > 1) {
        // lab block never crosses lunch, so the rows are contiguous
        ws.mergeCells(top, col, rowOf[e.period + e.span - 1], col);
      }
      cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: e.type === 'lab' ? 'FFFEF3C7' : 'FFE0E7FF' } };
    }
    ws.eachRow((row) => row.eachCell((c) => { c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }; }));
  }

  const all = wb.addWorksheet('All entries');
  all.columns = ['Day', 'Batch', 'Period', 'Time', 'Subject', 'Type', 'Teacher', 'Room'].map((h) => ({ header: h, width: 18 }));
  all.getRow(1).font = { bold: true };
  tt.timetable.forEach((e) => all.addRow([e.day, e.batch, e.period_label, `${e.start}-${e.end}`, e.subject, e.type, e.teacher, e.room]));
  return wb.xlsx.writeBuffer();
}

function toPdf(tt) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { settings, slots } = tt;
    const L = settings.lunch_after;
    const grids = batchGrids(tt.timetable);
    if (!grids.length) { doc.fontSize(14).text('This timetable has no entries.'); doc.end(); return; }

    grids.forEach((g, gi) => {
      if (gi > 0) doc.addPage();
      doc.fontSize(16).fillColor('#4f46e5').text(`${g.name} - Weekly Timetable`, { continued: false });
      doc.fontSize(8).fillColor('#64748b').text(`${tt.name}   |   generated ${new Date(tt.generated_at).toLocaleString()}`);
      doc.moveDown(0.5);

      const x0 = 28, timeW = 82;
      const colW = (doc.page.width - 56 - timeW) / settings.days.length;
      let y = doc.y;
      const rowH = 52, lunchH = 18, headH = 22;

      doc.rect(x0, y, timeW + colW * settings.days.length, headH).fill('#4f46e5');
      doc.fillColor('#fff').fontSize(9).text('Time', x0 + 4, y + 7, { width: timeW - 8 });
      settings.days.forEach((d, i) => doc.text(d, x0 + timeW + i * colW, y + 7, { width: colW, align: 'center' }));
      y += headH;

      const rowY = {};
      for (const s of slots) {
        rowY[s.period] = y;
        doc.rect(x0, y, timeW, rowH).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
        doc.fillColor('#0f172a').fontSize(8).text(`P${s.period}\n${s.start}-${s.end}`, x0 + 4, y + 18, { width: timeW - 8 });
        settings.days.forEach((_, i) => doc.rect(x0 + timeW + i * colW, y, colW, rowH).lineWidth(0.5).strokeColor('#e2e8f0').stroke());
        y += rowH;
        if (s.period === L && L < slots.length) {
          doc.rect(x0, y, timeW + colW * settings.days.length, lunchH).fill('#f1f5f9');
          doc.fillColor('#64748b').fontSize(8).text('Lunch Break', x0, y + 5, { width: timeW + colW * settings.days.length, align: 'center' });
          y += lunchH;
        }
      }
      for (const e of g.rows) {
        const di = settings.days.indexOf(e.day);
        if (di < 0) continue;
        const top = rowY[e.period];
        const h = rowY[e.period + e.span - 1] + rowH - top;
        const x = x0 + timeW + di * colW;
        doc.rect(x + 1, top + 1, colW - 2, h - 2).fillAndStroke(e.type === 'lab' ? '#fef3c7' : '#e0e7ff', '#cbd5e1');
        doc.fillColor('#0f172a').fontSize(8.5).text(labelOf(e), x + 4, top + h / 2 - 14, { width: colW - 8, align: 'center' });
        doc.fillColor('#475569').fontSize(7.5).text(`${e.teacher} | ${e.room}`, x + 4, doc.y, { width: colW - 8, align: 'center' });
      }
    });
    doc.end();
  });
}

module.exports = { toXlsx, toPdf };
