// Glue between the imported payroll data and the layout model, shared by the app and the tests.

import { buildPayslipDocument, type PayslipDocument } from './layoutModel'
import type { ImportedPayroll } from './payrollFile'
import { computePayslip, type PayslipComputation } from './payslip'
import { ratesFor, type RatesVersion } from './statutoryRates'
import type { PayslipTemplate, TemplateMapping } from './template'
import { layoutPage, type DrawList } from '../writers/pageGeometry'

export interface BuildSettings {
  template: PayslipTemplate
  mapping: TemplateMapping
  rateVersions: readonly RatesVersion[]
  /** What to say when no version is in force (the dashboard's rates are not loaded, or none saved). */
  whyNoRates?: string | null
  period: string
  /** Row index -> line ids whose missing figure was accepted as zero. */
  treatAsZero?: ReadonlyMap<number, ReadonlySet<string>>
}

const NONE: ReadonlySet<string> = new Set()

export function computeAll(data: ImportedPayroll, settings: BuildSettings): PayslipComputation[] {
  const rates = ratesFor(settings.rateVersions, settings.period)
  return data.rows.map((row, rowIndex) =>
    computePayslip({
      row,
      rowIndex,
      template: settings.template,
      mapping: settings.mapping,
      rates,
      whyNoRates: settings.whyNoRates,
      treatAsZero: settings.treatAsZero?.get(rowIndex) ?? NONE,
    }),
  )
}

export function documentFor(
  data: ImportedPayroll,
  computation: PayslipComputation,
  template: PayslipTemplate,
  period: string,
  issueDate: string,
): PayslipDocument {
  return buildPayslipDocument({
    template,
    computation,
    company: data.company,
    nic: String(data.rows[computation.rowIndex].ID),
    period,
    issueDate,
  })
}

/**
 * "SURNAME Other names - YYYY-MM.pdf". Two employees with the same name get " (2)", " (3)"...
 * The NIC is never part of a file name.
 */
export function payslipFileNames(names: readonly string[], period: string, extension = 'pdf'): string[] {
  const used = new Map<string, number>()
  return names.map((name) => {
    // Characters Windows does not allow in a file name.
    const clean = name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'Payslip'
    const base = `${clean} - ${period}`
    const count = (used.get(base.toLowerCase()) ?? 0) + 1
    used.set(base.toLowerCase(), count)
    return count === 1 ? `${base}.${extension}` : `${base} (${count}).${extension}`
  })
}

export interface PreparedPayslip {
  computation: PayslipComputation
  /** Null while the payslip has an error: a payslip with a hole in it is never laid out. */
  document: PayslipDocument | null
  page: DrawList | null
}

/**
 * Everything the screen and the exports need for each employee. A page the payslip font cannot
 * print correctly (a missing character, a text too long for its cell) becomes an error here, so
 * it blocks the export like any other.
 */
export function preparePayslips(data: ImportedPayroll, settings: BuildSettings, issueDate: string): PreparedPayslip[] {
  return computeAll(data, settings).map((computation) => {
    if (!computation.totals || computation.errors.length > 0) return { computation, document: null, page: null }
    const document = documentFor(data, computation, settings.template, settings.period, issueDate)
    const page = layoutPage(document)
    const errors = [...computation.errors]
    if (page.unsupported.length > 0) {
      errors.push({
        code: 'unsupported-character',
        message: `The payslip font cannot print these characters: ${page.unsupported.join(' ')}`,
      })
    }
    for (const text of page.overflow) {
      errors.push({ code: 'too-long', message: `"${text}" is too long to fit on the payslip, even at the smallest size.` })
    }
    return errors.length > 0
      ? { computation: { ...computation, errors }, document: null, page: null }
      : { computation, document, page }
  })
}
