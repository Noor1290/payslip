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
