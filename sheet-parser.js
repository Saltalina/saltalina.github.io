/* sheet-parser.js — CSV + multi-table sheet parsing (UMD: main.js + unit tests) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SheetParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  function parseCsvRows(text) {
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch !== '\r') field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /* Generic multi-table parser — table NAMES are auto-detected; the sheet
     STRUCTURE is what we rely on: a row of table names directly above a
     header row where every table block starts with a "Name" column.
     Returns { tables: [detected names in column order], data: { name: [entries] } } */
  function parseSheetCsv(text) {
    const rows = parseCsvRows(text);

    // header row = first row with >=2 cells equal to "Name"
    let headerRow = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].filter((c) => c.trim() === 'Name').length >= 2) { headerRow = i; break; }
    }
    if (headerRow === -1) throw new Error('Could not find Headers row (a row with multiple "Name" cells).');

    const cols = [];
    rows[headerRow].forEach((c, ci) => { if (c.trim() === 'Name') cols.push(ci); });

    // The table-name row is NOT necessarily directly above the header
    // (real sheets have HP / TOTAL DMG / AVERAGE rows in between).
    // Scan upward for the first row with >=2 non-empty cells at Name columns.
    let nameRow = [];
    for (let i = headerRow - 1; i >= Math.max(0, headerRow - 15); i--) {
      const hits = cols.filter((ci) => (rows[i][ci] || '').trim() !== '').length;
      if (hits >= 2) { nameRow = rows[i]; break; }
    }
    const seen = new Set();
    const tables = cols.map((ci, k) => {
      let name = (nameRow[ci] || '').trim();
      if (!name) name = `Table ${k + 1}`;
      while (seen.has(name)) name += ' *'; // dedupe
      seen.add(name);
      return { name, col: ci };
    });

    const data = {};
    const starts = new Set(tables.map((t) => t.col));
    for (const { name, col } of tables) {
      const headers = [];
      let ci = col;
      // stop at an empty header cell OR at the next table's start column
      while (ci < rows[headerRow].length && rows[headerRow][ci].trim() !== '' && !(ci > col && starts.has(ci))) {
        headers.push(rows[headerRow][ci].trim());
        ci++;
      }
      const entries = [];
      for (let i = headerRow + 1; i < rows.length; i++) {
        const r = rows[i];
        if (col < r.length && r[col].trim() !== '') {
          const entry = {};
          headers.forEach((h, j) => { entry[h] = (col + j < r.length ? r[col + j] : '').trim(); });
          entries.push(entry);
        }
      }
      data[name] = entries;
    }
    return { tables: tables.map((t) => t.name), data };
  }

  return { parseCsvRows, parseSheetCsv };
});
