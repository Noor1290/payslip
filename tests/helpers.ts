import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { importPayrollText, type ImportedPayroll, type PayrollRow } from '../src/lib/payrollFile'
import { ratesFor } from '../src/lib/statutoryRates'

const here = dirname(fileURLToPath(import.meta.url))
export const root = resolve(here, '..')

export const FIXTURE_NAME = 'ABC Co Ltd-pdf-fill-2026-09.json'
export const HUB_SAMPLE_NAME = 'hub-sample-mismatch-2026-09.json'

export function readFixtureText(name: string): string {
  return readFileSync(resolve(here, 'fixtures', name), 'utf8')
}

export function loadFixture(name = FIXTURE_NAME): ImportedPayroll {
  const result = importPayrollText(readFixtureText(name), name)
  if (!result.ok) throw new Error(`Fixture ${name} did not import: ${JSON.stringify(result.errors)}`)
  return result.data
}

export function fixtureRow(surname: string, name = FIXTURE_NAME): PayrollRow {
  const row = loadFixture(name).rows.find((r) => r.Surname === surname)
  if (!row) throw new Error(`No fixture row with surname ${surname}`)
  return { ...row }
}

export const septemberRates = ratesFor(DEFAULT_STATUTORY_RATES, '2026-09')!

export function readFont(name: 'regular' | 'bold'): Uint8Array {
  return new Uint8Array(readFileSync(resolve(root, 'src/assets/fonts', `texgyrepagella-${name}.otf`)))
}

/**
 * Compares `actual` with a recording in tests/expected. The recording is written only when it does
 * not exist yet, or when UPDATE_RECORDINGS=1 is set on purpose; otherwise any difference fails.
 */
export function expectRecorded(name: string, actual: unknown): void {
  const file = resolve(here, 'expected', `${name}.json`)
  const text = `${JSON.stringify(actual, null, 2)}\n`
  if (!existsSync(file) || process.env.UPDATE_RECORDINGS === '1') {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  expect(JSON.parse(text)).toEqual(JSON.parse(readFileSync(file, 'utf8')))
}

/**
 * Compares `actual` with a FROZEN recording in tests/frozen. It is written once, when the file
 * does not exist; UPDATE_RECORDINGS does not rewrite it. An issued payslip must always be drawn
 * the same way, so a difference here is never settled by recording again (CLAUDE.md, hard rules).
 */
export function expectFrozen(name: string, actual: unknown): void {
  const file = resolve(here, 'frozen', `${name}.json`)
  const text = `${JSON.stringify(actual, null, 2)}\n`
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  expect(JSON.parse(text)).toEqual(JSON.parse(readFileSync(file, 'utf8')))
}

export function readFrozen<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(here, 'frozen', `${name}.json`), 'utf8')) as T
}

/** Reads a recording back, for the tests that prove a recording can fail. */
export function readRecorded<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(here, 'expected', `${name}.json`), 'utf8')) as T
}
