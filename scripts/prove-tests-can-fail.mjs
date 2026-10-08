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
  ['A refusal code is mistaken for another', 'src/lib/hubWire.ts', "return failure(isRefusalCode(refusal.code) ? refusal.code : 'no-answer', hubError,", "return failure(isRefusalCode(refusal.code) ? 'invalid' : 'no-answer', hubError,"],
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
  ['A reopened cell loses its bold', 'src/lib/issuedLines.ts', 'bold: cell.bold ?? false,', 'bold: false,'],
  ['A reopened money cell is aligned left', 'src/lib/issuedLines.ts', "const defaultAlign = (kind: DocCell['kind']) => (kind === 'money' ? 'right' : 'left')", "const defaultAlign = (_kind: DocCell['kind']) => 'left' as const"],
  ['A rule under a row is not stored', 'src/lib/issuedLines.ts', "...(row.ruleBelow === null ? {} : { rule: row.ruleBelow }),", ''],
  ['A stored payslip in an unknown format is read anyway', 'src/lib/issuedLines.ts', 'if (format !== LINES_FORMAT) {', 'if (false) {'],
  ['An unknown field in a stored payslip is ignored', 'src/lib/issuedLines.ts', 'const rowSchema = z.strictObject({', 'const rowSchema = z.looseObject({'],
  ['The reason for a figure accepted as zero is not stored', 'src/lib/issuedLines.ts', "...(reason ? { reason } : {}) }", '}'],
  ['The built-in template can be issued', 'src/lib/issueBuild.ts', "else if (input.choice.kind !== 'published') {", 'else if (false) {'],
  ['A draft being previewed can be issued', 'src/lib/issueBuild.ts', 'if (input.previewingDraft) problems.push(', 'if (false) problems.push('],
  ['A month can be issued with payroll data of another month', 'src/lib/issueBuild.ts', 'else if (input.data.period !== input.period) problems.push(', 'else if (false) problems.push('],
  ['A difference accepted without a reason can be issued', 'src/lib/reasons.ts', "    if (!reason) {\n      missing.push(`${check.label} was accepted without a reason`)\n      continue\n    }\n", ''],
  ['A figure treated as zero needs no reason', 'src/lib/reasons.ts', 'else missing.push(`${line.label} was treated as zero without a reason`)', ''],
  ['An accepted difference swaps its two amounts', 'src/lib/reasons.ts', 'payroll: check.payrollCents / 100, payslip: check.payslipCents / 100,', 'payroll: check.payslipCents / 100, payslip: check.payrollCents / 100,'],
  ['Every payslip is sent with expected_revision 0', 'src/lib/issueBuild.ts', 'expectedRevision: issued?.revision ?? 0,', 'expectedRevision: 0,'],
  ['The name of the employee is sent to the dashboard', 'src/lib/issueStore.ts', '    national_id: payslip.nationalId,\n', '    national_id: payslip.nationalId,\n    name: payslip.name,\n'],
  ['The rates snapshot is left out of an issue', 'src/lib/issueStore.ts', '    rates: payslip.rates,\n', '    rates: null,\n'],
  ['An issue no longer carries the BRN', 'src/lib/issueStore.ts', "return { action: 'issue', brn: pending.brn,", "return { action: 'issue',"],
  ['After "locked" the app reloads as if it might have been stored', 'src/lib/issueStore.ts', "if (sent.failure.kind === 'locked') return { ...none, end: 'locked', failure: sent.failure }", "if (sent.failure.kind === 'locked') return checkIssue(port, pending, sent.failure)"],
  ['The employee at fault is named one position off', 'src/lib/issueStore.ts', '(pending.payslips[sent.failure.index]?.name ?? null)', '(pending.payslips[sent.failure.index + 1]?.name ?? null)'],
  ['Issue: any moved revision counts as my issue', 'src/lib/issueStore.ts', "if (!latest || now !== payslip.expectedRevision + 1 || !latest.issuedByYou || canonicalJson(latest.lines) !== canonicalJson(payslip.lines)) mine = false", ''],
  ['Issue: an issue by someone else counts as mine', 'src/lib/issueStore.ts', '|| !latest.issuedByYou || canonicalJson', '|| canonicalJson'],
  ['Issue: a month where only some moved counts as issued', 'src/lib/issueStore.ts', "    if (now === payslip.expectedRevision) {\n      mine = false\n      continue\n    }", "    if (now === payslip.expectedRevision) continue"],
  ['Issue: nobody moved counts as issued', 'src/lib/issueStore.ts', "if (moved.length === 0) return { verdict: 'not-saved', moved }", "if (moved.length === 0) return { verdict: 'saved', moved }"],
  ['A payslip over 16 KB is sent anyway', 'src/lib/issueStore.ts', 'if (tooLarge.length > 0) return { ok: false, tooLarge }', ''],
  ['A month is never split, whatever its size', 'src/lib/issueStore.ts', 'if (current.length > 0 && (current.length >= ISSUE_MAX_PAYSLIPS || used + size > budget)) {', 'if (false) {'],
  ['An answer about another month is used', 'src/lib/issueStore.ts', "if (answer.period !== period) return { ok: false, failure: failure('bad-answer') }", ''],
  ['The month load is cut off after 15 seconds', 'src/lib/hubWire.ts', "const reply = options.timeoutMs === null ? await asked.catch(() => NO_ANSWER) :", 'const reply = false ? await asked.catch(() => NO_ANSWER) :'],
  ['A payslip changed since it was issued still shows as the issued one', 'src/lib/issueBuild.ts', 'same = sameLines(encodeLines(document, figuresOf(computation, zeroReasons)), issued.lines)', 'same = true'],
  ['An identical re-issue is not asked about a second time', 'src/lib/issueBuild.ts', 'if (issued && sameAsIssued(payslip, issued)) identical.push(', 'if (false) identical.push('],
  ['A payslip issued with another template version counts as identical', 'src/lib/issueBuild.ts', '    issued.templateVersion === payslip.templateVersion &&\n', ''],
  ['A payslip with another reason for a difference counts as identical', 'src/lib/issueBuild.ts', '    canonicalJson(issued.acceptedDifferences) === canonicalJson(payslip.acceptedDifferences) &&\n', ''],
  ['The question about an identical re-issue names the wrong revision', 'src/lib/issueBuild.ts', 'Issue an identical revision ${revision + 1} anyway?', 'Issue an identical revision ${revision} anyway?'],
  ['The drawing version is not stored with the payslip', 'src/lib/issuedLines.ts', "    { kind: 'document', format: LINES_FORMAT, ...page },", "    { kind: 'document', format: LINES_FORMAT, ...page, drawing: undefined },"],
  ['A payslip with an unknown drawing version is read anyway', 'src/lib/issuedLines.ts', 'if (!KNOWN_DRAWINGS.includes(drawing)) return { ok: false, problem: unknownDrawing(drawing) }', ''],
  ['A payslip with an unknown drawing version is drawn anyway', 'src/writers/pageGeometry.ts', 'if (!KNOWN_DRAWINGS.includes(doc.drawing)) throw new Error(unknownDrawing(doc.drawing))', ''],
  ['A payslip issued before the drawing version was recorded shows as changed', 'src/lib/issuedLines.ts', 'return [{ ...lines[0], drawing: DRAWING_BEFORE_IT_WAS_RECORDED }, ...lines.slice(1)]', 'return lines'],
  ['A stopped run counts the failed batch as issued', 'src/lib/useIssuing.ts', "const doneUpTo = run.status === 'done' ? run.batches.length : run.at", "const doneUpTo = run.status === 'done' ? run.batches.length : run.at + 1"],
  ['Month review: a one-cent change counts as unchanged', 'src/lib/monthCompare.ts', '  changed: line.cents !== before.cents,', '  changed: Math.abs(line.cents - before.cents) > 1,'],
  ['Month review: a line without a partner does not make a row Changed', 'src/lib/monthCompare.ts', "  match: 'only-current',\n  unmatched: why,\n  last: null,\n  current: line.cents,\n  difference: null,\n  changed: true,", "  match: 'only-current',\n  unmatched: why,\n  last: null,\n  current: line.cents,\n  difference: null,\n  changed: false,"],
  ['Month review: across templates lines are matched by id', 'src/lib/monthCompare.ts', "last.template.id === now.template.id ? 'id' : 'label'", "last.template.id === now.template.id ? 'id' : 'id'"],
  ['Month review: a label used twice is paired with the first one', 'src/lib/monthCompare.ts', 'beforeCount.get(label) === 1 && nowCount.get(label) === 1', '(beforeCount.get(label) ?? 0) >= 1 && (nowCount.get(label) ?? 0) >= 1'],
  ['Month review: labels are compared with their capitals', 'src/lib/monthCompare.ts', "return label.trim().replace(/\\s+/g, ' ').toLowerCase()", "return label.trim().replace(/\\s+/g, ' ')"],
  ['Month review: someone missing from this month is not listed as Left', 'src/lib/monthCompare.ts', '    ...baseline.payslips.filter((payslip) => !present.has(payslip.nationalId)).map(leftRow),\n', ''],
  ['Month review: a new employee shows as Unchanged', 'src/lib/monthCompare.ts', "      status: 'new',", "      status: 'unchanged',"],
  ['Month review: a stored payslip of another month is compared', 'src/lib/monthCompare.ts', 'if (decoded.document.period !== period) {', 'if (false) {'],
  ['Month review: a stored payslip that cannot be read is compared as empty', 'src/lib/monthCompare.ts', "if (!before.side) return { ...base, ...none, status: 'cannot-compare', problem: before.problem, baselineRevision: before.revision }", "if (!before.side) return { ...base, ...none, status: 'unchanged', problem: null, baselineRevision: before.revision }"],
  ['Month review: the month before January is month 0', 'src/lib/monthCompare.ts', 'return month === 1 ? `${year - 1}-12` :', 'return false ? `${year - 1}-12` :'],
  ['Month review: a template change is not announced', 'src/lib/monthCompare.ts', 'if (otherTemplates.length > 0) {', 'if (false) {'],
  ['Month review: a rates change is not announced', 'src/lib/monthCompare.ts', 'if (otherRates.length > 0) {', 'if (false) {'],
  ['Month review: a name change makes a row Changed', 'src/lib/monthCompare.ts', 'const changed = lines.some((line) => line.changed) || totals.some((total) => total.changed)', 'const changed = lines.some((line) => line.changed) || totals.some((total) => total.changed) || last.employeeName !== now.employeeName'],
  ['Month review: a failed load of last month counts as an empty month', 'src/lib/monthReview.ts', "if (issued.status === 'failed') return { status: 'failed', what: 'issued', failure: issued.failure }", "if (issued.status === 'failed') return { status: 'nothing' }"],
  ['Month review: an empty last month is compared as if everyone were new', 'src/lib/monthReview.ts', "  if (issued.payslips.length === 0) return { status: 'nothing' }\n", ''],
  ['One label changes', 'src/lib/template.ts', "totalDeductions: 'Total Deductions'", "totalDeductions: 'Total Deduction'"],
  ['Band colour changes by one step', 'src/lib/layoutModel.ts', "BAND_FILL = '66CCFF'", "BAND_FILL = '66CCFE'"],
  ['Rows are one point taller on the page', 'src/writers/pageGeometry.ts', 'const ROW_HEIGHT = 17', 'const ROW_HEIGHT = 18'],
  ['PDF text is drawn one point to the right', 'src/writers/pdfWriter.ts', 'x: text.x,', 'x: text.x + 1,'],
  ['PDF text size changes', 'src/writers/pdfWriter.ts', 'size: text.size,', 'size: text.size + 1,'],
  ['The embedded font keeps the header viewers refuse', 'src/writers/pdfWriter.ts', '  for (const font of Object.values(embedded)) repairFontProgram(pdf, font)\n', ''],
  ['A font header with offset size 5 passes as valid', 'src/writers/fontProgram.ts', 'if (offsetSize < 1 || offsetSize > 4) return', 'if (offsetSize < 1 || offsetSize > 5) return'],  ['Excel divider is no longer thick', 'src/writers/excelWriter.ts', "border.right = { style: 'thick', color: BLACK }", "border.right = { style: 'medium', color: BLACK }"],
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

// An optional word narrows the run to the changes whose name or file contains it:
//   node scripts/prove-tests-can-fail.mjs "Month review"
const only = process.argv[2]?.toLowerCase()
const chosen = only ? changes.filter(([name, file]) => name.toLowerCase().includes(only) || file.toLowerCase().includes(only)) : changes

let missed = 0
for (const [name, file, before, after] of chosen) {
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
  console.error(`\n${missed} of ${chosen.length} changes were not caught.`)
  process.exit(1)
}
console.log(`\nAll ${chosen.length} one-value changes made the tests fail, and every file was restored.`)
