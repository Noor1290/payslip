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
  ['From your file: a number in the file is kept in the layout', 'src/lib/sheetRead.ts', "const source = typed !== null && typed.trim() !== '' ? ({ type: 'text', value: typed.slice(0, MAX_TEXT) } as const) : ({ type: 'empty' } as const)", "const source = value !== null ? ({ type: 'text', value: String(typed ?? value).slice(0, MAX_TEXT) } as const) : ({ type: 'empty' } as const)"],
  ['From your file: a merged block is lost on reading', 'src/lib/sheetRead.ts', '.filter((merge) => merge.top >= top && merge.bottom <= bottom && merge.left >= left && merge.right <= right)', '.filter(() => false)'],
  ['From your file: the month is written with its short name', 'src/lib/sheetFormats.ts', "      case 'MMMM':\n        return MONTHS[Number(month) - 1]", "      case 'MMMM':\n        return MONTHS[Number(month) - 1].slice(0, 3)"],
  ['From your file: Excel shows the month in the language of the computer', 'src/lib/sheetFormats.ts', 'return `[$-409]${pieces', 'return `${pieces'],
  ['From your file: a zero is no longer a dash', 'src/lib/sheetFormats.ts', "if (format.dash && isZero(rounded)) return { text: '-', value: rounded, places }", ''],
  ['From your file: a missing figure is a zero', 'src/lib/sheetEvaluate.ts', "if (!money.ok) return { problem: money.reason === 'missing' ? 'missing-key' : money.reason }", "if (!money.ok) return { value: ZERO }"],
  ['From your file: the total rounded once rounds each part', 'src/lib/sheetEvaluate.ts', "if (!once && term.round === 'whole') value = roundHalfUp(value, 0)", "if (term.round === 'whole' || once) value = roundHalfUp(value, 0)"],
  ['From your file: a company\'s own value is ignored', 'src/lib/sheetEvaluate.ts', 'return this.plain(this.context.own[cell.id] ?? source.value, cell)', 'return this.plain(source.value, cell)'],
  ['From your file: an employer column can be chosen', 'src/lib/sheetBody.ts', 'if (blocked.has(normaliseKey(key)) || isEmployerContributionKey(key)) {', 'if (false) {'],
  ['From your file: a loop is not noticed', 'src/lib/sheetEvaluate.ts', "if (this.stack.includes(of.id)) return { problem: this.stack.at(-1) === of.id ? 'self-reference' : 'loop' }", "if (this.stack.includes(of.id)) return { value: ZERO }"],
  ['From your file: a text too long is cut, not refused', 'src/writers/sheetGeometry.ts', '      overflow.push(cell.text)\n      return', '      return'],
  ['From your file: a long name goes below 9 points', 'src/lib/sheetFit.ts', 'export const NAME_MIN_SIZE = 9', 'export const NAME_MIN_SIZE = 8'],
  ['From your file: a name on two lines does not make its row grow', 'src/lib/sheetFit.ts', '  if (missing <= 0) return\n', '  if (missing <= 0 || true) return\n'],
  ['From your file: the page sets a fitted name smaller again', 'src/writers/sheetGeometry.ts', '      size = cell.size\n', '      size = Math.min(cell.size, MIN_SIZE)\n'],
  ['From your file: Excel loses the size of a fitted name', 'src/writers/sheetExcel.ts', 'if (cell.size !== undefined) target.font', 'if (false) target.font'],
  ['From your file: the split address keeps the whole address in its first cell', 'src/lib/sheetEvaluate.ts', "if (field === 'address1') return addressAtLastComma(company.address)[0]", "if (field === 'address1') return company.address"],
  ['From your file: the payslip keeps the whole address in the first cell of the split', 'src/lib/sheetFit.ts', '  const splits = addressSplits(addressParts(address))\n  const sizeIn', "  const splits: Split[] = [{ lines: [address, ''], atComma: true }]\n  const sizeIn"],
  ['From your file: the split address never moves a part down', 'src/lib/sheetFit.ts', '  if (atNormal) return { split: atNormal, size: null }', '  return { split: splits[0], size: null }'],
  ['From your file: half of a split address is allowed alone', 'src/lib/sheetBody.ts', 'if ((before > 0 || after > 0) && (before !== 1 || after !== 1)) {', 'if (false) {'],
  ['From your file: narrow margins are not Excel\'s', 'src/writers/sheetGeometry.ts', 'narrow: { x: 18, y: 54 }', 'narrow: { x: 28, y: 54 }'],
  ['From your file: printing at 100% is ignored', 'src/writers/sheetGeometry.ts', "const scale = input.fit === false ? 1 : fitted", 'const scale = fitted'],
  ['From your file: the small-print warning starts at 80%', 'src/writers/sheetGeometry.ts', 'export const SMALL_PRINT_SCALE = 0.85', 'export const SMALL_PRINT_SCALE = 0.8'],
  ['From your file: Excel keeps its old margins', 'src/writers/sheetExcel.ts', "left: doc.margins === 'narrow' ? 0.25 : 0.7", 'left: 0.4'],
  ['From your file: an upload never takes narrow margins', 'src/lib/sheetRead.ts', '(sheet.pageSetup.margins?.left ?? 0.7) <= 0.45', '(sheet.pageSetup.margins?.left ?? 0.7) <= 0'],
  ['From your file: a total is compared before it is rounded as printed', 'src/lib/sheetDocument.ts', "if (cell.total) facts.totals[cell.total] = { cents: value.kind === 'number' && !value.problem ? centsOf(value) : null, name: cellName(body, rowIndex, cell.col) }", "if (cell.total) facts.totals[cell.total] = { cents: value.kind === 'number' && !value.problem ? centsOf({ ...value, number: (value as { exact?: typeof value.number }).exact ?? value.number }) : null, name: cellName(body, rowIndex, cell.col) }"],
  ['From your file: a difference of 0.02 counts as rounding', 'src/lib/sheetDocument.ts', "diffCents === 0 ? 'match' : Math.abs(diffCents) === 1 ? 'rounding' : 'difference'", "diffCents === 0 ? 'match' : Math.abs(diffCents) <= 2 ? 'rounding' : 'difference'"],
  ['From your file: Net Pay is checked against Gross Pay', 'src/lib/sheetDocument.ts', "const CHECK_OF: Record<SheetTotal, CheckId> = { earnings: 'gross', deductions: 'deductions', net: 'net' }", "const CHECK_OF: Record<SheetTotal, CheckId> = { earnings: 'gross', deductions: 'deductions', net: 'gross' }"],
  ['From your file: a missing payroll total is not an error', 'src/lib/sheetDocument.ts', "      errors.push({ code: PROBLEM_CODE[payroll.reason], lineId: `check-${id}`,", "      void ({ code: PROBLEM_CODE[payroll.reason], lineId: `check-${id}`,"],
  ['From your file: no word when no total is marked', 'src/lib/sheetDocument.ts', "if (Object.keys(facts.totals).length === 0) warnings.push({ code: 'no-totals', message: NO_TOTALS })", ''],
  ['From your file: issuing does not wait for the three totals', 'src/lib/issueBuild.ts', 'if (TOTALS.some((total) => !marked.has(total))) problems.push(UNMARKED_TOTALS)', ''],
  ['From your file: two cells can be the same total', 'src/lib/sheetBody.ts', 'if (marked.length > 1) problems.push(', 'if (marked.length > 2) problems.push('],
  ['From your file: a text cell can be a total', 'src/lib/sheetBody.ts', "if (cell.source.type !== 'payroll' && cell.source.type !== 'calc') {", 'if (false) {'],
  ['From your file: an empty required cell is not listed', 'src/lib/sheetDocument.ts', "if (cell.required && !value.problem && value.text.trim() === '') facts.requiredEmpty.push(title)", ''],
  ['From your file: an empty required cell blocks the download', 'src/lib/sheetDocument.ts', "for (const title of facts.requiredEmpty) warnings.push({ code: 'required-empty',", "for (const title of facts.requiredEmpty) errors.push({ code: 'required-empty',"],
  ['From your file: a payslip with an empty required cell is issued', 'src/lib/issueBuild.ts', '    if (empty.length > 0) {', '    if (false) {'],
  ['From your file: treated as zero for one employee, zero for all', 'src/lib/sheetDocument.ts', 'buildSheetDocument(sheet, row, period, today, treatAsZero.get(rowIndex))', 'buildSheetDocument(sheet, row, period, today, treatAsZero.get(0))'],
  ['From your file: text in a money field is treated as zero', 'src/lib/sheetEvaluate.ts', "if (!money.ok && money.reason === 'missing' && this.context.zero?.has(cellId)", "if (!money.ok && this.context.zero?.has(cellId)"],
  ['From your file: employee NSF can be treated as zero', 'src/lib/sheetEvaluate.ts', '[DEFAULT_TABLE_MAPPING.lines.csg, DEFAULT_TABLE_MAPPING.lines.nsf]', '[DEFAULT_TABLE_MAPPING.lines.csg]'],
  ['From your file: a cell treated as zero needs no reason', 'src/lib/reasons.ts', '...(computation.zeroCells ?? [])]', ']'],
  ['From your file: a zero in a calculation makes the whole cell zero', 'src/lib/sheetEvaluate.ts', "      const money = this.money(of.key, cellId)", "      if (this.context.zero?.has(cellId)) return { value: ZERO, zeroed: true }\n      const money = this.money(of.key, cellId)"],
  ['From your file: today\'s date makes an issued payslip "Changed since"', 'src/lib/sheetIssued.ts', '(cell?.today === true ? { ...cell, text: \'\', iso: \'\' } : cell)', '(false ? { ...cell, text: \'\', iso: \'\' } : cell)'],
  ['From your file: the cell of today\'s date is not marked', 'src/lib/sheetDocument.ts', "      if (cell.source.type === 'date' && cell.source.of === 'today') printed.today = true\n", ''],
  ['From your file: a stored cell may name a style that is not there', 'src/lib/sheetIssued.ts', '  if (!inside) return { ok: false, problem: NOT_MATCHING }', ''],
  ['From your file: a payslip of an unknown drawing is drawn anyway', 'src/lib/sheetIssued.ts', '  if (!KNOWN_SHEET_DRAWINGS.includes(page.drawing)) return { ok: false, problem: unknownDrawing(page.drawing) }', ''],
  ['From your file: the size of a fitted name is not stored', 'src/lib/sheetIssued.ts', '    ...(cell.size === undefined ? {} : { size: cell.size }),\n', ''],
  ['From your file: a stored payslip with an unknown key is read', 'src/lib/sheetIssued.ts', 'const documentSchema = z.strictObject({', 'const documentSchema = z.object({'],
  ['From your file: the rates are stored with a payslip of a layout', 'src/lib/issueBuild.ts', 'rates: isSheetDocument(document) ? null : ratesSnapshot(input.rates),', 'rates: ratesSnapshot(input.rates),'],
  ['From your file: the Excel file takes the time of the clock', 'src/writers/excelWriter.ts', '{ level: 6, mtime: new Date(year, month - 1, 1) }', '{ level: 6 }'],
  ['From your file: a stored payslip of a layout is read as a Table one', 'src/lib/issuedLines.ts', "(lines[0] as { format?: unknown } | null)?.format === SHEET_LINES_FORMAT) {\n    return decodeSheetLines(lines)", "(lines[0] as { format?: unknown } | null)?.format === -1) {\n    return decodeSheetLines(lines)"],
  ['From your file: issuing still waits for the next stage', 'src/lib/issueBuild.ts', "  } else if (isSheetBody(input.choice.body)) {\n", "  } else if (isSheetBody(input.choice.body)) {\n    problems.push('Issuing them comes in the next stage.')\n"],
  ['From your file: the PDF takes the date of the clock', 'src/writers/pdfWriter.ts', '  pdf.setModificationDate(fileDate)\n', '  pdf.setModificationDate(new Date())\n'],
  ['From your file: Excel loses the number format', 'src/writers/sheetExcel.ts', 'target.numFmt = excelNumberFormat(format, cell.places ?? 0)', ''],
  ['From your file: a removed row leaves its merged block where it was', 'src/lib/sheetEdit.ts', 'if (at < start) return [start - 1, length]', 'if (at < start) return [start, length]'],
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
  ['A stored template may map an employer column', 'src/lib/templateBody.ts', 'if (key && (blocked.has(normaliseKey(key)) || isEmployerContributionKey(key))) {', 'if (false) {'],
  ['A stored template may drop a required line', 'src/lib/templateBody.ts', 'if (!deductions.some((line) => line.id === id)) {', 'if (false) {'],
  ['A required line may be left unmapped', 'src/lib/templateBody.ts', '} else if (body.mapping.lines[id]?.key === null) {', '} else if (false) {'],
  ['A template in an unknown format is read anyway', 'src/lib/templateBody.ts', 'if (schema !== BODY_SCHEMA) {', 'if (false) {'],
  ['An unknown field in a stored template is ignored', 'src/lib/templateBody.ts', "crossCheck: z.strictObject({ csgBase: columnName, nsfBase: columnName, nsfBaseToConfirm: z.boolean() }),\n  }),", "crossCheck: z.strictObject({ csgBase: columnName, nsfBase: columnName, nsfBaseToConfirm: z.boolean() }),\n  }).loose(),"],
  ['An image is accepted in a stored template', 'src/lib/templateBody.ts', 'if (hasEmbeddedFile(body)) problems.push(', 'if (false) problems.push('],
  ['A stored template loses the old column names', 'src/lib/templateBody.ts', '...(fixed?.aliases ? { aliases: [...fixed.aliases] } : {}),', ''],
  ['Bodies are compared with their key order', 'src/lib/templateBody.ts', 'return canonicalJson(a) === canonicalJson(b)', 'return JSON.stringify(a) === JSON.stringify(b)'],
  ['The employment date is read from another key', 'src/lib/template.ts', "dateOfEmployment: 'Date of Employment',", "dateOfEmployment: 'Date of employment',"],
  ['A date of employment that is not a date is shown anyway', 'src/lib/payslip.ts', "dateOfEmployment = typeof value === 'string' ? readDateOfEmployment(value) : null", "dateOfEmployment = typeof value === 'string' ? value : null"],
  ["A draft can be exported", "src/lib/templateUse.ts", "      kind: 'draft',\n      chip: `${name}, ${revision} (not published)`,\n      exportBlock: DRAFT_EXPORT_BLOCK,", "      kind: 'draft',\n      chip: `${name}, ${revision} (not published)`,\n      exportBlock: null,"],
  ["A draft of a layout from a file can be exported", "src/lib/templateUse.ts", "        kind: 'draft',\n        chip: `${name}, ${revision} (not published)`,\n        exportBlock: DRAFT_EXPORT_BLOCK,", "        kind: 'draft',\n        chip: `${name}, ${revision} (not published)`,\n        exportBlock: null,"],
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
  ['Long name: a name too long for one line is not put on two', 'src/lib/build.ts', "const named = withNameInWideArea(document, typeof row.Surname === 'string' ? row.Surname : '')", 'const named = document'],
  ['Long name: a name is broken inside the surname', 'src/writers/pageGeometry.ts', "name.indexOf(' ', surname.length); at > 0; at = name.indexOf(' ', at + 1)) {\n    const size = sizeToFit([", "name.indexOf(' ', 0); at > 0; at = name.indexOf(' ', at + 1)) {\n    const size = sizeToFit(["],
  ['Long name: on a tie, the shorter first line is chosen', 'src/writers/pageGeometry.ts', 'font, normal, available)\n    if (size !== null && (best === null || size >= best.size))', 'font, normal, available)\n    if (size !== null && (best === null || size > best.size))'],
  ['Wide name: a name is broken inside the surname', 'src/writers/pageGeometry.ts', "name.indexOf(' ', surname.length); at > 0; at = name.indexOf(' ', at + 1)) {\n    const size = sizeToFitFrom([", "name.indexOf(' ', 0); at > 0; at = name.indexOf(' ', at + 1)) {\n    const size = sizeToFitFrom(["],
  ['Wide name: on a tie, the shorter first line is chosen', 'src/writers/pageGeometry.ts', 'NAME_MIN_SIZE)\n    if (size !== null && (best === null || size >= best.size))', 'NAME_MIN_SIZE)\n    if (size !== null && (best === null || size > best.size))'],
  ['Long name: the rows below a two-line name do not move down', 'src/writers/pageGeometry.ts', '? 2 * ROW_HEIGHT : ROW_HEIGHT))', '? ROW_HEIGHT : ROW_HEIGHT))'],
  ['Long name: the second line is drawn over the first', 'src/writers/pageGeometry.ts', 'const y = top + lineIndex * ROW_HEIGHT + ROW_HEIGHT / 2 + capHeight / 2', 'const y = top + ROW_HEIGHT / 2 + capHeight / 2'],
  ['Long name: Excel keeps the usual row height', 'src/writers/excelWriter.ts', 'if (nameRow) sheetRow.height = wide ? NAME_LINE_HEIGHT * wide.lines.length : TWO_LINE_NAME_ROW_HEIGHT', 'if (false) sheetRow.height = wide ? NAME_LINE_HEIGHT * wide.lines.length : TWO_LINE_NAME_ROW_HEIGHT'],
  ['Long name: Excel does not wrap the name', 'src/writers/excelWriter.ts', '...(isName ? { wrapText: true } : {})', '...{}'],
  ['Long name: Excel keeps the usual size for a smaller name', 'src/writers/excelWriter.ts', 'const size = isName && nameExcelSize ? nameExcelSize :', 'const size = false ? nameExcelSize :'],
  ['Long name: Excel keeps the usual size for a name set smaller on one line', 'src/writers/excelWriter.ts', '    : printedName && printedName.size < printedName.normal ?', '    : twoLines && printedName && printedName.size < printedName.normal ?'],
  ['Long name: the new drawing version makes an issued payslip "Changed since"', 'src/lib/issuedLines.ts', 'drawing: sameLookAs(first.drawing)', 'drawing: first.drawing'],
  ['Address: split at the first comma again', 'src/lib/build.ts', 'return withAddressSplitAtLastComma(named, data.company.addressLines)', 'return named'],
  ['Address: words are moved down before parts at a comma', 'src/writers/pageGeometry.ts', "if (line[at - 1] !== ',') splits.push(", "if (line[at - 1] !== ',') splits.splice(1, 0, "],
  ['Address: lines may be set smaller than 8 points', 'src/writers/pageGeometry.ts', 'const ADDRESS_MIN_SIZE = 8', 'const ADDRESS_MIN_SIZE = 6'],
  ['Address: the two lines are set smaller each on its own', 'src/writers/pageGeometry.ts', "const fitted = sizeToFitFrom(lines, font, PRINT_SIZE[cells[0].size], cellWidth(doc, cells[0]), ADDRESS_MIN_SIZE)", "const fitted = sizeToFitFrom(lines.slice(0, 1), font, PRINT_SIZE[cells[0].size], cellWidth(doc, cells[0]), ADDRESS_MIN_SIZE)"],
  ['Address: extra spaces are kept', 'src/writers/pageGeometry.ts', ".map((part) => part.replace(/\\s+/g, ' ').trim())", '.map((part) => part.trim())'],
  ['Address: Excel keeps the usual size for smaller lines', 'src/writers/excelWriter.ts', 'isAddress && addressExcelSize ? addressExcelSize :', 'false ? addressExcelSize :'],
  ['Address: drawing 3 makes an issued payslip "Changed since"', 'src/lib/layoutModel.ts', '(drawing === 2 || drawing === 3 || drawing === 4 ? 1 : drawing)', '(drawing === 2 || drawing === 4 ? 1 : drawing)'],
  ['Address: another split of the same address shows as "Changed since"', 'src/lib/issuedLines.ts', 'return addressReadings(a).some((reading) => readings.includes(reading))', "return a.join('|') === b.join('|')"],
  ['Address: words moved down to line 4 make another address', 'src/lib/issuedLines.ts', "return [`${line3}, ${line4}`, `${line3} ${line4}`]", 'return [`${line3}, ${line4}`]'],
  ['Address: a changed address text counts as the same', 'src/lib/issuedLines.ts', "  return canonicalJson(first.lines) === canonicalJson(second.lines) && sameAddress(first.address, second.address)", '  return canonicalJson(first.lines) === canonicalJson(second.lines)'],
  ['Wide name: a name its column takes only below 9 points stays there', 'src/writers/pageGeometry.ts', 'cellWidth(doc, name), NAME_ONE_LINE_MIN_SIZE) : null', 'cellWidth(doc, name), NAME_MIN_SIZE) : null'],
  ['Wide name: one line in the wide place below 9 points', 'src/writers/pageGeometry.ts', 'lines.length === 1 ? NAME_ONE_LINE_MIN_SIZE : NAME_MIN_SIZE)', 'NAME_MIN_SIZE)'],
  ['Wide name: Excel keeps a name on one line below 9 points', 'src/writers/pageGeometry.ts', 'const EXCEL_NAME = { oneLineMin: 9, min: 8, maxLines: 3 }', 'const EXCEL_NAME = { oneLineMin: 7, min: 8, maxLines: 3 }'],
  ['Wide name: Excel sets a name below 8 points', 'src/writers/pageGeometry.ts', 'const EXCEL_NAME = { oneLineMin: 9, min: 8, maxLines: 3 }', 'const EXCEL_NAME = { oneLineMin: 9, min: 6, maxLines: 3 }'],
  ['Wide name: Excel row height ignores the wrapped lines', 'src/writers/excelWriter.ts', 'wide ? NAME_LINE_HEIGHT * wide.lines.length : TWO_LINE_NAME_ROW_HEIGHT', 'TWO_LINE_NAME_ROW_HEIGHT'],
  ['Wide name: Excel writes the page lines, not its own', 'src/writers/excelWriter.ts', 'wideNameRow(row, wide.lines)', "wideNameRow(row, [row.cells.find((cell) => cell.col === 1)?.text ?? ''])"],
  ['Wide name: the name may be set below 8 points', 'src/writers/pageGeometry.ts', 'const NAME_MIN_SIZE = 8', 'const NAME_MIN_SIZE = 6'],
  ['Wide name: no gap after "Name :"', 'src/writers/pageGeometry.ts', 'const left = colX[0] + PADDING_X + (label ? widthInColumn(doc, label) + NAME_GAP : 0)', 'const left = colX[0] + PADDING_X + (label ? widthInColumn(doc, label) : 0)'],
  ['Wide name: the date of employment does not move right', 'src/writers/pageGeometry.ts', 'return cell ? { ...text, x: round(area.moved.get(cell)!) } : text', 'return text'],
  ['Wide name: two lines before one smaller line', 'src/writers/pageGeometry.ts', '  if (nameOnPageAlone(doc) !== null) return doc', '  if (nameOnPageAlone(doc)?.wide === false) return doc'],
  ['Wide name: Excel keeps the name in column C', 'src/writers/excelWriter.ts', '(cell.col === 1 ? { ...cell, span: 2 as const, text:', '(cell.col === 1 ? { ...cell, span: 1 as const, text:'],
  ['Wide name: Excel sizes a wide name by the page alone', 'src/writers/pageGeometry.ts', 'Math.floor((11 * room) / Math.max(', 'Math.floor((11 * room * 2) / Math.max('],
  ['Wide name: Excel puts the date in E without its label', 'src/writers/excelWriter.ts', 'target.numFmt = isWideDate && wideRow?.dateFormat ? wideRow.dateFormat : FORMAT_DATE', 'target.numFmt = FORMAT_DATE'],
  ['Wide name: a name broken elsewhere shows as "Changed since"', 'src/lib/issuedLines.ts', "  const read = (lines: unknown) => withoutAddress(withNameOnOneLine(withLook(withDrawing(lines))))", "  const read = (lines: unknown) => withoutAddress(withLook(withDrawing(lines)))"],
  ['Wide name: drawing 4 makes an issued payslip "Changed since"', 'src/lib/layoutModel.ts', '(drawing === 2 || drawing === 3 || drawing === 4 ? 1 : drawing)', '(drawing === 2 || drawing === 3 ? 1 : drawing)'],
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
  ['Month review: an empty last month is compared as if everyone were new', 'src/lib/monthReview.ts', "if (issued.payslips.length > 0) return { status: 'ready', baseline: baselineFromIssued(lastPeriod, issued.payslips) }", "if (true) return { status: 'ready', baseline: baselineFromIssued(lastPeriod, issued.payslips) }"],
  ['Month review: payroll figures are used although a payslip was issued last month', 'src/lib/monthReview.ts', "if (issued.payslips.length > 0) return { status: 'ready', baseline: baselineFromIssued(lastPeriod, issued.payslips) }", "if (issued.payslips.length > 0 && !payroll) return { status: 'ready', baseline: baselineFromIssued(lastPeriod, issued.payslips) }"],
  ['Month review: with no payslip issued last month, the issue does not wait for the payroll answer', 'src/lib/monthReview.ts', "if (state.status === 'none-issued') return [", 'if (false) return ['],
  ['Month review: a failed payroll request counts as "no payroll"', 'src/lib/monthReview.ts', "if (payroll.status === 'failed') return { status: 'failed', what: 'payroll', failure: payroll.failure }", "if (payroll.status === 'failed') return { status: 'nothing' }"],
  ['Month review: a declined payroll request is read as "no saved run"', 'src/lib/baseline.ts', 'refusal.data.code === undefined && NO_RUN.some((sentence) => sentence.test(said))', 'true'],
  ['Month review: payroll of another month is used as last month', 'src/lib/baseline.ts', '|| answer.data.meta.period !== period) return', ') return'],
  ['Month review: payroll rows of another company are used', 'src/lib/baseline.ts', 'if (wrongCompany(imported.data.company.brn) || (', 'if (false && ('],
  ['Month review: the payroll request carries more than the month', 'src/lib/baseline.ts', "reply = await port.send('request-data', { dataType: PAYROLL_RESULT, period })", "reply = await port.send('request-data', { dataType: PAYROLL_RESULT, period, params: { brn } })"],
  ['Month review: bulk-approve also approves changed, new and left rows', 'src/lib/monthReview.ts', "comparison.rows.filter((row) => row.status === 'unchanged' && !isReviewed(marks, comparison, row))", 'comparison.rows.filter((row) => !isReviewed(marks, comparison, row))'],
  ['Month review: a review mark survives a change of figures', 'src/lib/monthReview.ts', 'return marks[markKey(comparison, row)] === reviewFingerprint(comparison, row)', 'return marks[markKey(comparison, row)] !== undefined'],
  ['Month review: a mark does not notice that last month was issued again', 'src/lib/monthReview.ts', '    baselineRevision: row.baselineRevision,\n    lines: row.lines.map(', '    lines: row.lines.map('],
  ['Month review: issuing does not wait for the comparison', 'src/lib/monthReview.ts', "if (state.status === 'not-asked') return [`Compare with ${last} first, in the month review. Issuing waits for it.`]", "if (state.status === 'not-asked') return []"],
  ['Month review: a comparison that failed to load does not block issuing', 'src/lib/monthReview.ts', "if (state.status === 'failed') return [`The comparison with ${last} could not be loaded, so nothing is issued yet. Ask again in the month review.`]", "if (state.status === 'failed') return []"],
  ['Month review: changed and new payslips can be issued unreviewed', 'src/lib/monthReview.ts', '  if (toReview.length > 0) {', '  if (false) {'],
  ['Month review: unchanged payslips need no approval', 'src/lib/monthReview.ts', '  if (toApprove.length > 0) {', '  if (false) {'],
  ['Month review: someone who left needs no acknowledgement', 'src/lib/monthReview.ts', '  if (left.length > 0) {', '  if (false) {'],
  ['Month review: a payslip that is not selected must be reviewed too', 'src/lib/monthReview.ts', "chosen.has(row.rowIndex) && row.status !== 'unchanged')", "row.status !== 'unchanged')"],
  ['Month review: the review reasons are dropped, so the month can be issued', 'src/lib/monthReview.ts', 'return { ok: false, problems: build.ok ? [...problems] : [...build.problems, ...problems] }', 'return build'],
  ['One label changes', 'src/lib/template.ts', "totalDeductions: 'Total Deductions'", "totalDeductions: 'Total Deduction'"],
  ['Band colour changes by one step', 'src/lib/layoutModel.ts', "BAND_FILL = '66CCFF'", "BAND_FILL = '66CCFE'"],
  ['Rows are one point taller on the page', 'src/writers/pageGeometry.ts', 'const ROW_HEIGHT = 17', 'const ROW_HEIGHT = 18'],
  ['PDF text is drawn one point to the right', 'src/writers/pdfWriter.ts', 'x: text.x,', 'x: text.x + 1,'],
  ['PDF text size changes', 'src/writers/pdfWriter.ts', 'size: text.size,', 'size: text.size + 1,'],
  ["The embedded font keeps the header viewers refuse", "src/writers/pdfWriter.ts", "  for (const font of Object.values(embedded)) repairFontProgram(pdf, font)\n\n  return pdf.save()", "  return pdf.save()"],
  ["A layout from a file: the embedded font keeps the header viewers refuse", "src/writers/pdfWriter.ts", "  for (const font of Object.values(embedded)) repairFontProgram(pdf, font)\n  return pdf.save({ updateFieldAppearances: false })", "  return pdf.save({ updateFieldAppearances: false })"],
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
