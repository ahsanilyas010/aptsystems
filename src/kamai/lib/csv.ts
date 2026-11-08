import Papa, { type ParseError } from 'papaparse'

export interface CsvParseResult<T> {
  rows: T[]
  errors: ParseError[]
  fields: string[]
}

/**
 * Parse a CSV File or string into objects keyed by header. Headers are
 * trimmed and lower-cased with spaces -> underscores so "Credit Limit" becomes
 * `credit_limit`. Empty lines are skipped; values are kept as strings.
 */
export function parseCsv<T extends Record<string, string> = Record<string, string>>(
  input: File | string,
  opts?: { normalizeHeaders?: boolean },
): Promise<CsvParseResult<T>> {
  const normalize = opts?.normalizeHeaders ?? true
  return new Promise((resolve, reject) => {
    Papa.parse<T>(input as never, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h: string) => (normalize ? h.trim().toLowerCase().replace(/\s+/g, '_') : h.trim()),
      transform: (v: string) => (typeof v === 'string' ? v.trim() : v),
      complete: (res) =>
        resolve({
          rows: res.data,
          errors: res.errors,
          fields: res.meta.fields ?? [],
        }),
      error: (err: Error) => reject(err),
    })
  })
}

/** Serialize rows to CSV text (header from `columns` or the first row's keys). */
export function toCsv<T extends Record<string, unknown>>(rows: T[], columns?: Array<keyof T & string>): string {
  const cols = columns ?? (rows[0] ? (Object.keys(rows[0]) as Array<keyof T & string>) : [])
  // escapeFormulae prefixes cells starting with = + - @ (tab/CR) with a quote, defusing spreadsheet formula injection.
  return Papa.unparse(
    { fields: cols, data: rows.map((r) => cols.map((c) => (r[c] === null || r[c] === undefined ? '' : r[c]))) },
    { escapeFormulae: true },
  )
}

/** Trigger a browser download of CSV text. Prepends a UTF-8 BOM for Excel. */
export function downloadCsv(filename: string, csvText: string): void {
  const name = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`
  const blob = new Blob(['﻿', csvText], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Convenience: rows -> CSV -> download. */
export function downloadRowsAsCsv<T extends Record<string, unknown>>(filename: string, rows: T[], columns?: Array<keyof T & string>): void {
  downloadCsv(filename, toCsv(rows, columns))
}
