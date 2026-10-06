// Reading a payroll result: the JSON file the payroll app calls "Export for PDF fill (JSON)",
// or (from Phase 2) the same rows arriving from the hub. Both go through importPayrollRows.
//
// File-level problems refuse the whole file. Problems with one employee's figures (a missing
// key, text in a money field) are NOT handled here: they are reported per employee, per line,
// when the payslip is calculated.

import { z } from 'zod'

export type PayrollValue = string | number | boolean | null
export type PayrollRow = Record<string, PayrollValue>

export interface Company {
  name: string
  /** Always two entries; the second is '' for a one-part address. */
  addressLines: [string, string]
  brn: string
}

export interface ImportedPayroll {
  rows: PayrollRow[]
  /** Every key found in the rows, in first-seen order. */
  keys: string[]
  company: Company
  /** "YYYY-MM" when the file name or the hub gave it. */
  period: string | null
  fileName: string | null
}

export interface ImportError {
  row?: number
  message: string
}

export type ImportResult = { ok: true; data: ImportedPayroll } | { ok: false; errors: ImportError[] }

const valueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const COMPANY_KEYS = ['Company Name', 'Address', 'BRN'] as const
const COMPANY_HINT = 'To include it, tick Company Details in the payroll export.'

/** "ABC Co Ltd-pdf-fill-2026-09.json" -> "2026-09". */
export function periodFromFileName(name: string): string | null {
  const matches = [...name.matchAll(/(\d{4})-(\d{2})(?!\d)/g)]
  const last = matches[matches.length - 1]
  if (!last) return null
  const period = `${last[1]}-${last[2]}`
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : null
}

/** Keys are compared ignoring case and stray spaces, so "paye " and "PAYE" are the same column. */
export function normaliseKey(key: string): string {
  return key.trim().replace(/\s+/g, ' ').toLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * JSON.parse silently keeps the last of two identical keys, so repeated keys are found in the
 * text itself. Only called on text that already parsed, so the walk can assume valid JSON.
 */
export function findRepeatedKeys(text: string): { row: number; key: string }[] {
  const found: { row: number; key: string }[] = []
  let i = 0
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i])) i++
  }
  const readString = (): string => {
    const start = i
    i++
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1
    i++
    return JSON.parse(text.slice(start, i)) as string
  }
  const readValue = (row: number, depth: number): void => {
    skipSpace()
    const ch = text[i]
    if (ch === '{') {
      i++
      skipSpace()
      if (text[i] === '}') {
        i++
        return
      }
      const seen = new Set<string>()
      for (;;) {
        skipSpace()
        const key = readString().trim()
        if (depth === 1) {
          if (seen.has(key)) found.push({ row, key })
          seen.add(key)
        }
        skipSpace()
        i++ // the colon
        readValue(row, depth + 1)
        skipSpace()
        if (text[i] === ',') {
          i++
          continue
        }
        i++ // the closing brace
        return
      }
    }
    if (ch === '[') {
      i++
      skipSpace()
      if (text[i] === ']') {
        i++
        return
      }
      let index = 0
      for (;;) {
        index++
        readValue(depth === 0 ? index : row, depth + 1)
        skipSpace()
        if (text[i] === ',') {
          i++
          continue
        }
        i++ // the closing bracket
        return
      }
    }
    if (ch === '"') {
      readString()
      return
    }
    while (i < text.length && !/[,\]}\s]/.test(text[i])) i++
  }
  readValue(0, 0)
  return found
}

function splitAddress(address: string): [string, string] {
  const parts = address
    .split(/\r?\n|,/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  if (parts.length === 0) return ['', '']
  return [parts[0], parts.slice(1).join(', ')]
}

export function importPayrollText(text: string, fileName?: string): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, errors: [{ message: 'This file is not valid JSON. Export it again from the payroll app.' }] }
  }
  const repeated = Array.isArray(parsed) ? findRepeatedKeys(text) : []
  return importPayrollRows(parsed, { fileName, repeatedKeys: repeated })
}

export function importPayrollRows(
  input: unknown,
  options: { fileName?: string; period?: string; repeatedKeys?: { row: number; key: string }[] } = {},
): ImportResult {
  if (!Array.isArray(input)) {
    return {
      ok: false,
      errors: [{ message: 'Expected a list of employees, but the file contains something else.' }],
    }
  }
  if (input.length === 0) return { ok: false, errors: [{ message: 'The file contains no employees.' }] }

  const errors: ImportError[] = []
  const fail = (row: number, message: string) => errors.push({ row, message })

  for (const { row, key } of options.repeatedKeys ?? []) {
    fail(row, `Row ${row} has two columns named "${key}". Rename one of them in the payroll app.`)
  }

  const rows: PayrollRow[] = []
  const keys: string[] = []
  const knownKeys = new Set<string>()
  const firstRowById = new Map<string, number>()
  const companies = new Set<string>()
  const missingCompanyKeys = new Set<string>()
  let company: Company | null = null

  input.forEach((raw, index) => {
    const rowNumber = index + 1
    if (!isRecord(raw)) {
      fail(rowNumber, `Row ${rowNumber} is not an employee record.`)
      return
    }

    const row: PayrollRow = {}
    const seenNormalised = new Map<string, string>()
    let usable = true
    for (const [rawKey, rawValue] of Object.entries(raw)) {
      const key = rawKey.trim()
      const value = valueSchema.safeParse(rawValue)
      if (!value.success) {
        fail(rowNumber, `Row ${rowNumber}: "${key}" holds a list or an object, not a single value.`)
        usable = false
        continue
      }
      const normalised = normaliseKey(key)
      const earlier = seenNormalised.get(normalised)
      if (earlier !== undefined) {
        fail(rowNumber, `Row ${rowNumber} has two columns named "${earlier}". Rename one of them in the payroll app.`)
        usable = false
        continue
      }
      seenNormalised.set(normalised, key)
      row[key] = typeof value.data === 'string' ? value.data.trim() : value.data
    }

    const id = row.ID
    if (typeof id !== 'string' || id === '') {
      fail(rowNumber, `Row ${rowNumber}: ID is missing or is not text.`)
      usable = false
    } else {
      const first = firstRowById.get(id)
      // The ID is sensitive, so the message points at the other row instead of printing it.
      if (first !== undefined) {
        fail(rowNumber, `Row ${rowNumber}: ID is the same as row ${first}.`)
        usable = false
      } else firstRowById.set(id, rowNumber)
    }
    if (typeof row.Surname !== 'string' || row.Surname === '') {
      fail(rowNumber, `Row ${rowNumber}: Surname is missing or is not text.`)
      usable = false
    }
    if ('Other names' in row && row['Other names'] !== null && typeof row['Other names'] !== 'string') {
      fail(rowNumber, `Row ${rowNumber}: Other names is not text.`)
      usable = false
    }

    for (const key of COMPANY_KEYS) {
      if (!(key in row)) missingCompanyKeys.add(key)
    }
    const name = row['Company Name']
    const brn = row.BRN
    const address = row.Address
    if ('Company Name' in row && (typeof name !== 'string' || name === '')) {
      fail(rowNumber, `Row ${rowNumber}: Company Name is empty or is not text.`)
      usable = false
    }
    if ('BRN' in row && (typeof brn !== 'string' || brn === '')) {
      fail(rowNumber, `Row ${rowNumber}: BRN is empty or is not text.`)
      usable = false
    }
    if ('Address' in row && address !== null && typeof address !== 'string') {
      fail(rowNumber, `Row ${rowNumber}: Address is not text.`)
      usable = false
    }
    if (typeof name === 'string' && typeof brn === 'string' && name !== '' && brn !== '') {
      companies.add(`${name} (BRN ${brn})`)
      company ??= { name, brn, addressLines: splitAddress(typeof address === 'string' ? address : '') }
    }

    if (!usable) return
    for (const key of Object.keys(row)) {
      if (!knownKeys.has(key)) {
        knownKeys.add(key)
        keys.push(key)
      }
    }
    rows.push(row)
  })

  for (const key of COMPANY_KEYS) {
    if (missingCompanyKeys.has(key)) errors.push({ message: `"${key}" is missing from the data. ${COMPANY_HINT}` })
  }
  if (companies.size > 1) {
    errors.push({
      message: `This file mixes more than one company (${[...companies].join('; ')}). Each file must hold one company only.`,
    })
  }

  if (errors.length > 0 || !company) return { ok: false, errors }

  const period = options.period ?? (options.fileName ? periodFromFileName(options.fileName) : null)
  return { ok: true, data: { rows, keys, company, period, fileName: options.fileName ?? null } }
}

/** "SURNAME Other names", exactly as the payroll data has them. */
export function employeeName(row: PayrollRow): string {
  const surname = typeof row.Surname === 'string' ? row.Surname : ''
  const other = typeof row['Other names'] === 'string' ? row['Other names'] : ''
  return `${surname} ${other}`.trim()
}
