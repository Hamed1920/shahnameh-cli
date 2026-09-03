/**
 * Minimal RFC4180 CSV reader/writer.
 *
 * The registries carry prose descriptions full of commas and quotes, so a
 * split(',') would corrupt them. Small and dependency-free on purpose — this
 * must behave identically to PowerShell's Import-Csv/Export-Csv, which is what
 * writes these same files.
 */

export type Row = Record<string, string>

export function parseCsv(text: string): Row[] {
  const rows = parseRows(text)
  if (rows.length === 0) return []
  const header = rows[0]
  return rows.slice(1)
    .filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''))
    .map((cells) => {
      const row: Row = {}
      header.forEach((h, i) => (row[h] = cells[i] ?? ''))
      return row
    })
}

function parseRows(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const s = text.replace(/^﻿/, '')

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\r') {
      // handled by \n
    } else if (c === '\n') {
      row.push(field); field = ''
      out.push(row); row = []
    } else field += c
  }
  if (field !== '' || row.length > 0) { row.push(field); out.push(row) }
  return out
}

export function toCsv(rows: Row[], header: string[]): string {
  const esc = (v: string) => {
    const s = v ?? ''
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [header.map(esc).join(',')]
  for (const r of rows) lines.push(header.map((h) => esc(r[h] ?? '')).join(','))
  return lines.join('\r\n') + '\r\n'
}
