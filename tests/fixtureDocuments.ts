import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { computeAll, documentFor } from '../src/lib/build'
import type { PayslipDocument } from '../src/lib/layoutModel'
import { DEFAULT_TABLE_MAPPING, TABLE_TEMPLATE } from '../src/lib/template'
import { loadFixture } from './helpers'

export const PERIOD = '2026-09'
export const ISSUE_DATE = '2026-09-28'

/** The layout models of the seven fake employees: the input of every recording. */
export function fixtureDocuments(): PayslipDocument[] {
  const data = loadFixture()
  const computations = computeAll(data, {
    template: TABLE_TEMPLATE,
    mapping: DEFAULT_TABLE_MAPPING,
    rateVersions: DEFAULT_STATUTORY_RATES,
    period: PERIOD,
  })
  return computations.map((c) => documentFor(data, c, TABLE_TEMPLATE, PERIOD, ISSUE_DATE))
}
