// RFC4180 CSV, matching PowerShell Import-Csv / Export-Csv behaviour.
// Mirrors ../../lib/csv.ts. Kept as plain .mjs so the worker needs no build step.

export function parseCsv(text) {
  const rows = parseRows(text)
  if (rows.length === 0) return { header: [], rows: [] }
  const header = rows[0]
  const out = rows
    .slice(1)
    .filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''))
    .map((cells) => {
      const row = {}
      header.forEach((h, i) => (row[h] = cells[i] ?? ''))
      return row
    })
  return { header, rows: out }
}

function parseRows(text) {
  const out = []
  let row = []
  let field = ''
  let inQuotes = false
  const s = String(text).replace(/^﻿/, '')

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\r') { /* handled by \n */ }
    else if (c === '\n') { row.push(field); field = ''; out.push(row); row = [] }
    else field += c
  }
  if (field !== '' || row.length > 0) { row.push(field); out.push(row) }
  return out
}

export function toCsv(rows, header) {
  const esc = (v) => {
    const s = v ?? ''
    return /[",\r\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s)
  }
  const lines = [header.map(esc).join(',')]
  for (const r of rows) lines.push(header.map((h) => esc(r[h])).join(','))
  return lines.join('\r\n') + '\r\n'
}
