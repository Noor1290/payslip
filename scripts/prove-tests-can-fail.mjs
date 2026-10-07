// Proves the safety net is real: changes ONE value in the source, runs the tests, expects them
// to FAIL, and puts the file back exactly as it was. Every change below must be caught.
// Run: node scripts/prove-tests-can-fail.mjs
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const changes = [
  ['CSG tier test: > becomes >=', 'src/lib/statutoryRates.ts', 'base > rates.csgThreshold', 'base >= rates.csgThreshold'],
  ['NSF ceiling removed', 'src/lib/statutoryRates.ts', 'Math.min(base, rates.nsfCeiling)', 'base'],
  ['NSF 60+ exemption ignored', 'src/lib/statutoryRates.ts', 'if (isAged60 && rates.nsfExemptAt60) return 0', 'if (false) return 0'],
  ['Default CSG lower rate 1.5 becomes 1.6', 'src/data/defaultStatutoryRates.ts', 'csgEmployeeRateLow: 1.5', 'csgEmployeeRateLow: 1.6'],
  ['Default NSF ceiling 29,710 becomes 29,700', 'src/data/defaultStatutoryRates.ts', 'nsfCeiling: 29710', 'nsfCeiling: 29700'],
  ['A third decimal is accepted', 'src/lib/money.ts', 'if (fraction.length > 2)', 'if (fraction.length > 3)'],
  ['A zero no longer shows as "-"', 'src/lib/money.ts', "if (cents === 0) return '-'", "if (cents === 0) return '0'"],
  ['Net Pay is off by one cent', 'src/lib/payslip.ts', 'net: earnings - deductions }', 'net: earnings - deductions + 1 }'],
  ['A 0.02 difference counts as rounding', 'src/lib/payslip.ts', 'Math.abs(diffCents) === 1', 'Math.abs(diffCents) <= 2'],
  ['CSG is read from the employer column', 'src/lib/template.ts', "csg: { key: 'Employee CSG'", "csg: { key: 'CSG'"],
  ['A missing Employee NSF can be treated as zero', 'src/lib/template.ts', "nsf: { key: 'Employee NSF', aliases: ['NSF - 1%'], required: true }", "nsf: { key: 'Employee NSF', aliases: ['NSF - 1%'] }"],
  ['Repeated column names are not noticed', 'src/lib/payrollFile.ts', 'if (seen.has(key)) found.push({ row, key })', 'if (false) found.push({ row, key })'],
  ['Dashboard data of another kind is accepted', 'src/lib/hubBridge.ts', 'if (parsed.data.dataType !== PAYROLL_RESULT)', 'if (false)'],
  ['A pay month from the dashboard is not checked', 'src/lib/hubBridge.ts', 'meta: z.object({ period: periodSchema.optional(),', 'meta: z.object({ period: z.string().optional(),'],
  ['Adding data ignores the pay month', 'src/lib/hubBridge.ts', 'if (incoming.period !== existingPeriod) {', 'if (false) {'],
  ['Adding data allows the same employee twice', 'src/lib/hubBridge.ts', 'if (repeated > 0) {', 'if (false) {'],
  ['Payroll results for another company than their rows are accepted', 'src/lib/hubBridge.ts', 'if (brn !== undefined && normaliseBrn(brn) !== normaliseBrn(result.data.company.brn)) {', 'if (false) {'],
  ['A rates save no longer carries the BRN', 'src/lib/ratesStore.ts', '    brn: pending.brn,\n    effective_from:', '    effective_from:'],
  ['A rates save sends expected_revision + 1', 'src/lib/ratesStore.ts', 'expected_revision: pending.expectedRevision,', 'expected_revision: pending.expectedRevision + 1,'],
  ['A rate is rounded on its way to the dashboard', 'src/lib/ratesStore.ts', 'csg_employee_rate_low: input.csgEmployeeRateLow,', 'csg_employee_rate_low: Math.round(input.csgEmployeeRateLow),'],
  ['A new template is sent with a revision other than 0', 'src/lib/templateStore.ts', 'expected_revision: pending.templateId === null ? 0 : pending.expectedRevision,', 'expected_revision: pending.expectedRevision,'],
  ['A publish names another draft revision', 'src/lib/templateStore.ts', "template_id: pending.templateId, expected_revision: pending.expectedRevision }", "template_id: pending.templateId, expected_revision: pending.expectedRevision + 1 }"],
  ['An answer about another company is used', 'src/lib/hubWire.ts', 'if (expectedBrn !== null && normaliseBrn(brn) !== normaliseBrn(expectedBrn)) {', 'if (false) {'],
  ['An answer with no meta.brn is used', 'src/lib/hubWire.ts', "if (!brn) return { ok: false, failure: failure('no-company-brn') }", ''],
  ['An unanswered save is treated as final, with no reload', 'src/lib/hubWire.ts', "const UNCERTAIN: readonly FailureKind[] = ['unavailable', 'no-answer', 'bad-answer']", 'const UNCERTAIN: readonly FailureKind[] = []'],
  ['"unavailable" on a save is treated as final, with no reload', 'src/lib/hubWire.ts', "const UNCERTAIN: readonly FailureKind[] = ['unavailable', 'no-answer', 'bad-answer']", "const UNCERTAIN: readonly FailureKind[] = ['no-answer', 'bad-answer']"],
  ['Rates: any newer revision counts as my save', 'src/lib/ratesStore.ts', 'latest.createdByYou === true && sameRates(latest, pending.input)', 'true'],
  ['Rates: a save by someone else counts as mine', 'src/lib/ratesStore.ts', 'latest.createdByYou === true && sameRates', 'sameRates'],
  ['Rates: an unchanged revision counts as saved', 'src/lib/ratesStore.ts', "if (highest === pending.expectedRevision) return 'not-saved'", "if (highest === pending.expectedRevision) return 'saved'"],
  ['Draft: a different stored body counts as my save', 'src/lib/templateStore.ts', '&& sameBody(draft.body, pending.body)', ''],
  ['Draft: a save by someone else counts as mine', 'src/lib/templateStore.ts', 'draft.updatedByYou && draft.name', 'draft.name'],
  ['Publish: any new version counts as my publication', 'src/lib/templateStore.ts', "return mine ? { end: 'saved', failure: null, version: now }", "return true ? { end: 'saved', failure: null, version: now }"],
  ['A refusal code is mistaken for another', 'src/lib/hubWire.ts', "return failure(isRefusalCode(refusal.code) ? refusal.code : 'no-answer', hubError)", "return failure(isRefusalCode(refusal.code) ? 'invalid' : 'no-answer', hubError)"],
  ['Two refusal codes share a message', 'src/lib/hubWire.ts', "title: 'The dashboard no longer has this',", "title: 'The dashboard refused the data',"],
  ['A request waits forever for the dashboard', 'src/lib/hubWire.ts', 'const timer = setTimeout(() => resolve(NO_ANSWER), ms)', 'const timer = setTimeout(() => {}, ms)'],
  ['A row of the wrong type is used', 'src/lib/ratesStore.ts', 'const rate = z.number().min(0).max(100)', 'const rate = z.any()'],
  ['Inside the dashboard the cross-check falls back to the defaults', 'src/lib/ratesStore.ts', "return { versions: [], whyNone: `The dashboard has no statutory rates saved for this company, ${NOT_CHECKED}` }", "return { versions: DEFAULT_STATUTORY_RATES, whyNone: null }"],
  ['A rate with 5 decimals is accepted', 'src/lib/statutoryRates.ts', 'else if (decimalsOf(value) > 4)', 'else if (decimalsOf(value) > 5)'],
  ['An amount with 3 decimals is accepted', 'src/lib/statutoryRates.ts', 'else if (decimalsOf(value) > 2)', 'else if (decimalsOf(value) > 3)'],
  ['A typed figure like "1,5" or "1e2" is read as a number', 'src/lib/statutoryRates.ts', 'return /^\\d+(\\.\\d+)?$/.test(trimmed) ? Number(trimmed) : null', 'return Number.isFinite(parseFloat(trimmed)) ? parseFloat(trimmed) : null'],
  ['A stored template may map an employer column', 'src/lib/templateBody.ts', 'if (key && blocked.has(normaliseKey(key))) {', 'if (false) {'],
  ['A stored template may drop a required line', 'src/lib/templateBody.ts', 'if (!deductions.some((line) => line.id === id)) {', 'if (false) {'],
  ['A required line may be left unmapped', 'src/lib/templateBody.ts', '} else if (body.mapping.lines[id]?.key === null) {', '} else if (false) {'],
  ['A template in an unknown format is read anyway', 'src/lib/templateBody.ts', 'if (schema !== BODY_SCHEMA) {', 'if (false) {'],
  ['An unknown field in a stored template is ignored', 'src/lib/templateBody.ts', "crossCheck: z.strictObject({ csgBase: columnName, nsfBase: columnName, nsfBaseToConfirm: z.boolean() }),\n  }),", "crossCheck: z.strictObject({ csgBase: columnName, nsfBase: columnName, nsfBaseToConfirm: z.boolean() }),\n  }).loose(),"],
  ['An image is accepted in a stored template', 'src/lib/templateBody.ts', 'if (hasEmbeddedFile(body)) problems.push(', 'if (false) problems.push('],
  ['A stored template loses the old column names', 'src/lib/templateBody.ts', '...(fixed?.aliases ? { aliases: [...fixed.aliases] } : {}),', ''],
  ['Bodies are compared with their key order', 'src/lib/templateBody.ts', 'return canonicalJson(a) === canonicalJson(b)', 'return JSON.stringify(a) === JSON.stringify(b)'],
  ['The employment date is read from another key', 'src/lib/template.ts', "dateOfEmployment: 'Date of Employment',", "dateOfEmployment: 'Date of employment',"],
  ['A date of employment that is not a date is shown anyway', 'src/lib/payslip.ts', "if (typeof value === 'string' && isIsoDate(value)) dateOfEmployment = value", "if (typeof value === 'string') dateOfEmployment = value"],
  ['A draft can be exported', 'src/lib/templateUse.ts', 'exportBlock: DRAFT_EXPORT_BLOCK,', 'exportBlock: null,'],
  ['Payslips can be exported before the template is chosen', 'src/lib/templateUse.ts', 'exportBlock: input.choiceNeeded ? CHOOSE_EXPORT_BLOCK : null }', 'exportBlock: null }'],
  ['With two published templates one is picked silently', 'src/lib/templateUse.ts', 'if (published.length === 1) return', 'if (published.length >= 1) return'],
  ['Unsaved standalone changes pass as the plain built-in', 'src/lib/templateUse.ts', "version: 'built-in-1-edited' }", "version: 'built-in-1' }"],
  ['A required line can be removed in the editor', 'src/lib/templateEdit.ts', 'return !(id in FIXED_LINES)', 'return true'],
  ['Lines can be added past the end of the page', 'src/lib/templateEdit.ts', 'return force || bodyRows(added) <= MAX_BODY_ROWS ? added : body', 'return added'],
  ['Removing a line leaves its mapping behind', 'src/lib/templateEdit.ts', '  delete lines[id]\n', ''],
  ['"locked" on a save is treated as "maybe stored"', 'src/lib/hubWire.ts', "const UNCERTAIN: readonly FailureKind[] = ['unavailable', 'no-answer', 'bad-answer']", "const UNCERTAIN: readonly FailureKind[] = ['unavailable', 'no-answer', 'bad-answer', 'locked']"],
  ['The index of the payslip at fault is dropped', 'src/lib/hubWire.ts', 'hubError, refusal.index ?? null)', 'hubError, null)'],
  ['The role the dashboard reports is ignored', 'src/lib/hubWire.ts', 'role: answer.data.meta?.role ?? null,', 'role: null,'],
  ['One label changes', 'src/lib/template.ts', "totalDeductions: 'Total Deductions'", "totalDeductions: 'Total Deduction'"],
  ['Band colour changes by one step', 'src/lib/layoutModel.ts', "BAND_FILL = '66CCFF'", "BAND_FILL = '66CCFE'"],
  ['Rows are one point taller on the page', 'src/writers/pageGeometry.ts', 'const ROW_HEIGHT = 17', 'const ROW_HEIGHT = 18'],
  ['PDF text is drawn one point to the right', 'src/writers/pdfWriter.ts', 'x: text.x,', 'x: text.x + 1,'],
  ['PDF text size changes', 'src/writers/pdfWriter.ts', 'size: text.size,', 'size: text.size + 1,'],
  ['Excel divider is no longer thick', 'src/writers/excelWriter.ts', "border.right = { style: 'thick', color: BLACK }", "border.right = { style: 'medium', color: BLACK }"],
  ['Excel totals become plain values', 'src/writers/excelWriter.ts', 'target.value = { formula, result: centsToNumber(cents) }', 'target.value = centsToNumber(cents)'],
  ['Excel page is no longer A4', 'src/writers/excelWriter.ts', 'paperSize: 9,', 'paperSize: 1,'],
]

function runTests() {
  const reportFile = join(tmpdir(), `payslip-proof-${process.pid}.json`)
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--reporter=json', `--outputFile=${reportFile}`], {
    cwd: root,
    encoding: 'utf8',
  })
  let failed = 0
  let files = []
  try {
    const report = JSON.parse(readFileSync(reportFile, 'utf8'))
    failed = report.numFailedTests
    files = report.testResults
      .filter((file) => file.status === 'failed')
      .map((file) => file.name.split(/[\\/]tests[\\/]/)[1])
    rmSync(reportFile, { force: true })
  } catch {
    failed = -1
  }
  return { ok: result.status === 0, failed, files }
}

const baseline = runTests()
if (!baseline.ok) {
  console.error('The tests do not pass before any change. Fix that first.')
  process.exit(1)
}

let missed = 0
for (const [name, file, before, after] of changes) {
  const path = resolve(root, file)
  const original = readFileSync(path, 'utf8')
  if (original.split(before).length !== 2) {
    console.error(`SKIPPED  ${name}: "${before}" was not found exactly once in ${file}`)
    missed++
    continue
  }
  writeFileSync(path, original.replace(before, after))
  let result
  try {
    result = runTests()
  } finally {
    writeFileSync(path, original)
  }
  if (result.ok) {
    missed++
    console.error(`NOT CAUGHT  ${name}`)
  } else {
    console.log(`caught  ${name}  (${result.failed} failing in ${result.files.join(', ')})`)
  }
}

const after = runTests()
if (!after.ok) {
  console.error('The tests fail after restoring the files. Check the working tree.')
  process.exit(1)
}
if (missed > 0) {
  console.error(`\n${missed} of ${changes.length} changes were not caught.`)
  process.exit(1)
}
console.log(`\nAll ${changes.length} one-value changes made the tests fail, and every file was restored.`)
