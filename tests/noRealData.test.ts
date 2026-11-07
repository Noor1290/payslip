// The repo is public, so its fake data must not carry anything that may have come from a real
// payslip (CLAUDE.md, hard rules; payroll TODO A8). Until November 2026 a surname that might have
// been a real person's, and the amounts and dates of the owner's original workbook, were in the
// samples, the fixtures, the recordings and the reference files. They were replaced with invented
// ones. This test keeps them out: it holds only short SHA-256 digests of the old values, never the
// values themselves, so the test does not put them back into the repo.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** The old surname, and the old first names after it (lower case, one space). */
const OLD_WORDS = new Set(['489e998ef03be1d6'])
const OLD_NAME_PAIRS = new Set(['7ef27052b44cb472'])
/** The old date of employment and the old signature date, as YYYY-MM-DD. */
const OLD_DATES = new Set(['6111d807accf87a4', '9c84d43649eea52e'])
/** The old Basic Salary and Transport of DOE JANE, as "basic|transport". */
const OLD_PAY = new Set(['d5cfea7985d67271'])

const BINARY = /\.(pdf|xlsx|otf|ttf|woff2?|png|jpe?g|ico|gif|zip)$/i

function trackedTextFiles(): { path: string; text: string }[] {
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path !== '' && !BINARY.test(path))
  const files: { path: string; text: string }[] = []
  for (const path of paths) {
    let bytes: Buffer
    try {
      bytes = readFileSync(resolve(root, path))
    } catch {
      continue // listed by git but deleted in the working tree
    }
    if (!bytes.includes(0)) files.push({ path, text: bytes.toString('utf8') })
  }
  return files
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const iso = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

/** Every date written in one of the ways this repo writes dates, as YYYY-MM-DD. */
export function datesIn(text: string): string[] {
  const found: string[] = []
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})/g)) found.push(iso(+m[1], +m[2], +m[3]))
  for (const m of text.matchAll(/\b(\d{4})(\d{2})(\d{2})\b/g)) found.push(iso(+m[1], +m[2], +m[3]))
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g)) found.push(iso(+m[3], +m[2], +m[1]))
  for (const m of text.matchAll(/\b(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{2}|\d{4})\b/g)) {
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1
    if (month > 0) found.push(iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], month, +m[1]))
  }
  for (const m of text.matchAll(/\bdate\(\s*(\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\s*\)/g)) found.push(iso(+m[1], +m[2], +m[3]))
  for (const m of text.matchAll(/Date\.UTC\(\s*(\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\s*\)/g)) found.push(iso(+m[1], +m[2] + 1, +m[3]))
  return found
}

function namesIn(text: string): { words: string[]; pairs: string[] } {
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  return { words, pairs: words.slice(1).map((word, i) => `${words[i]} ${word}`) }
}

describe('no data that may be real, in any file of the repo (A8)', () => {
  const files = trackedTextFiles()

  it('reads the files of the repo', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(files.some((file) => file.path === 'samples/ABC Co Ltd-pdf-fill-2026-09.json')).toBe(true)
  })

  it('has neither the old surname nor the old first names', () => {
    const hits = files.flatMap(({ path, text }) => {
      const { words, pairs } = namesIn(text)
      return words.some((word) => OLD_WORDS.has(digest(word))) || pairs.some((pair) => OLD_NAME_PAIRS.has(digest(pair))) ? [path] : []
    })
    expect(hits).toEqual([])
  })

  it('has neither the old date of employment nor the old signature date, written in any way', () => {
    const hits = files.flatMap(({ path, text }) => (datesIn(text).some((date) => OLD_DATES.has(digest(date))) ? [path] : []))
    expect(hits).toEqual([])
  })

  it('gives DOE JANE invented pay in every sample and fixture', () => {
    const rows = files
      .filter(({ path }) => /^(samples|tests\/fixtures)\/.*\.json$/.test(path))
      .flatMap(({ path, text }) => {
        const parsed: unknown = JSON.parse(text)
        const list = Array.isArray(parsed) ? parsed : []
        return list.filter((row) => row?.Surname === 'DOE' && row?.['Other names'] === 'JANE').map((row) => ({ path, row }))
      })
    expect(rows.length).toBeGreaterThanOrEqual(4)
    const hits = rows.filter(({ row }) => OLD_PAY.has(digest(`${row['Basic Salary']}|${row.Travelling}`))).map(({ path }) => path)
    expect(hits).toEqual([])
  })

  it('the reference workbook has invented amounts and dates', async () => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(readFileSync(resolve(root, 'docs/reference/payslip-table-reference.xlsx')) as unknown as ArrayBuffer)
    const sheet = workbook.worksheets[0]
    const number = (address: string) => Number(sheet.getCell(address).value)
    const day = (address: string) => (sheet.getCell(address).value as Date).toISOString().slice(0, 10)
    expect(sheet.getCell('B16').value).toBe('Basic Salary ')
    expect(sheet.getCell('B18').value).toBe('Transport Allowance ')
    expect(OLD_PAY.has(digest(`${number('C16')}|${number('C18')}`))).toBe(false)
    expect(OLD_DATES.has(digest(day('E11')))).toBe(false)
    expect(OLD_DATES.has(digest(day('C32')))).toBe(false)
  })
})

describe('the date reader of this test', () => {
  it('finds a date however this repo writes it', () => {
    for (const text of ['2020-03-22', '20200322', '22/03/2020', '22-Mar-20', '22 March 2020', 'date(2020, 3, 22)', 'Date.UTC(2020, 2, 22)']) {
      expect(datesIn(text)).toContain('2020-03-22')
    }
  })
})
