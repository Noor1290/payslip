// The fallback baseline of the month review: last month's PAYROLL figures, used only when no
// payslip at all was issued last month (docs/BRIEF.md, decision D13).
//
// A payroll run is not a payslip: nothing says which template last month would have used. So its
// figures are put on the template in use NOW, line by line, exactly as this month's are. The
// review says "compared with payroll figures, not issued payslips" wherever it shows them.
//
// The request is the contract's own: request-data { dataType: "payroll-result", period }. The
// dashboard asks its user first and needs its password gate open. Last month's rows live in this
// tab's memory only, like this month's.

import { z } from 'zod'
import { computeAll } from './build'
import { PAYROLL_RESULT } from './hubBridge'
import { failure, normaliseBrn, refusalOf, type Failure, type HubPort } from './hubWire'
import type { Baseline, BaselinePayslip } from './monthCompare'
import { importPayrollRows, type ImportedPayroll } from './payrollFile'
import type { PayslipTemplate, TemplateMapping } from './template'

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

const answerSchema = z.object({
  ok: z.literal(true),
  dataType: z.literal(PAYROLL_RESULT),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(10_000),
  meta: z.object({ period: month, label: z.string().max(120).optional(), brn: z.string().max(50).optional() }),
})

const refusalSchema = z.object({ ok: z.literal(false), error: z.string().max(400).optional(), code: z.string().max(40).optional() })

/**
 * The dashboard's own words for "there is no payroll for that month". It gives no code for it
 * (docs/HUB_CHANGES.md asks for "not-found"), so the sentence is what tells it from a failure.
 * Anything else that is refused is a failure, and is asked again, never read as "no payroll".
 */
const NO_RUN = [/^There is no saved run for /, /^That run has no employees\.$/]

export type PayrollMonth =
  /** `data` is null when the dashboard has no payroll saved for that month. */
  | { ok: true; data: ImportedPayroll | null }
  | { ok: false; failure: Failure }

/** Asks the dashboard for ONE month's payroll run: last month's, for the company whose data is open. */
export async function loadPayrollMonth(port: HubPort, brn: string, period: string): Promise<PayrollMonth> {
  // No time-out of the app's own: the dashboard asks its user first, and the bridge waits for that.
  let reply: unknown
  try {
    reply = await port.send('request-data', { dataType: PAYROLL_RESULT, period })
  } catch {
    return { ok: false, failure: failure('no-answer') }
  }

  const refusal = refusalSchema.safeParse(reply)
  if (refusal.success) {
    const said = refusal.data.error?.trim() ?? ''
    if (refusal.data.code === 'not-found' || (refusal.data.code === undefined && NO_RUN.some((sentence) => sentence.test(said)))) return { ok: true, data: null }
    return { ok: false, failure: refusalOf(reply) ?? failure('no-answer') }
  }

  const answer = answerSchema.safeParse(reply)
  // The answer must be about the month that was asked for.
  if (!answer.success || answer.data.meta.period !== period) return { ok: false, failure: failure('bad-answer') }
  const imported = importPayrollRows(answer.data.rows, { period })
  if (!imported.ok) {
    const first = imported.errors[0]?.message ?? 'The rows could not be used.'
    return { ok: false, failure: { ...failure('bad-answer'), detail: `Last month's payroll figures were not used: ${first}` } }
  }
  // The rows say which company they are for; so does the dashboard, when it adds meta.brn.
  const wrongCompany = (found: string) => normaliseBrn(found) !== normaliseBrn(brn)
  if (wrongCompany(imported.data.company.brn) || (answer.data.meta.brn !== undefined && wrongCompany(answer.data.meta.brn))) {
    return { ok: false, failure: failure('other-company') }
  }
  return { ok: true, data: imported.data }
}

/**
 * Last month's payroll figures as a baseline: each row put on the template in use now, by the
 * same code that builds this month's payslips. A row that cannot be put on it (a figure missing
 * or wrong) is kept with the reason, and is never compared by guess.
 */
export function baselineFromPayroll(period: string, data: ImportedPayroll, template: PayslipTemplate, mapping: TemplateMapping): Baseline {
  // The cross-check is not part of a comparison: no rates are needed to copy the figures.
  const computations = computeAll(data, { template, mapping, rateVersions: [], period })
  return {
    period,
    source: 'payroll',
    payslips: computations.map((computation): BaselinePayslip => {
      const base = { nationalId: String(data.rows[computation.rowIndex].ID).trim(), employeeName: computation.employeeName, revision: null }
      const { totals } = computation
      const broken = computation.errors.find((error) => error.lineId !== undefined && !error.lineId.startsWith('check-'))
      // A payslip with a line in error has no totals: it is never laid out, and never compared.
      if (!totals) {
        return { ...base, side: null, problem: `Last month's payroll figures cannot be put on this template. ${broken?.message ?? 'A figure is missing or wrong.'}` }
      }
      return {
        ...base,
        side: {
          employeeName: computation.employeeName,
          dateOfEmployment: computation.dateOfEmployment,
          template: null,
          rates: null,
          figures: {
            lines: computation.lines.map((line) => ({ id: line.id, label: line.label, side: line.side, cents: line.cents, source: line.sourceKey, status: line.status as 'ok' | 'unmapped' | 'treated-as-zero' })),
            totals: { ...totals },
          },
        },
        problem: null,
      }
    }),
  }
}
