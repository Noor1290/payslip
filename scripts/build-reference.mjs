// Rebuilds the reference "Table" payslip template as docs/reference/payslip-table-reference.xlsx,
// cell by cell, with FAKE data (ABC Co Ltd). It mirrors the owner's original workbook as it was:
// six earnings lines, whole-rupee formats, and its own formulas (CSG 1.5% and NSF 1% with no
// ceiling, which is why the app does not follow them). The original file is never copied here.
//
// Run: node scripts/build-reference.mjs
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/reference/payslip-table-reference.xlsx')

const BLACK = { argb: 'FF000000' }
const GREY = { argb: 'FFCCCCCC' }
const medium = (color = BLACK) => ({ style: 'medium', color })
const thick = { style: 'thick', color: BLACK }

const HEADING = { name: 'Book Antiqua', size: 12, bold: true }
const BODY = { name: 'Book Antiqua', size: 11 }
const PLAIN = { name: 'Calibri', size: 11 }
const BAND = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF66CCFF' }, bgColor: { argb: 'FF66CCFF' } }

const FMT_WHOLE = '_-* #,##0_-;-* #,##0_-;_-* "-"??_-;_-@'
const FMT_WHOLE_2 = '_-* #,##0_-;-* #,##0_-;_-* "-"?_-;_-@_-'
const DATE = 'd-mmm-yy'

const workbook = new ExcelJS.Workbook()
workbook.creator = 'Payslip app'
workbook.lastModifiedBy = 'Payslip app'
const sheet = workbook.addWorksheet('Sheet1', {
  pageSetup: {
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    scale: 61,
    margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  },
})
;[28.77734375, 32.77734375, 35.6640625, 40.5546875].forEach((width, index) => {
  sheet.getColumn(index + 2).width = width
})

function put(address, value, { font = PLAIN, border = {}, fill, align, numFmt } = {}) {
  const cell = sheet.getCell(address)
  if (value !== undefined) cell.value = value
  cell.font = font
  cell.border = border
  if (fill) cell.fill = fill
  if (align) cell.alignment = { horizontal: align }
  if (numFmt) cell.numFmt = numFmt
}

function band(row, text) {
  put(`B${row}`, text, { font: HEADING, fill: BAND, align: 'center', border: { left: medium(), top: medium(), bottom: medium() } })
  for (const col of ['C', 'D']) put(`${col}${row}`, undefined, { font: HEADING, fill: BAND, border: { top: medium(), bottom: medium() } })
  put(`E${row}`, undefined, { font: HEADING, fill: BAND, border: { right: medium(), top: medium(), bottom: medium() } })
  sheet.mergeCells(`B${row}:E${row}`)
  sheet.getRow(row).height = 16.2
}

function companyRow(row, text, top) {
  put(`B${row}`, text, { font: HEADING, align: 'center', border: { left: medium(), top: medium(top), bottom: medium(GREY) } })
  for (const col of ['C', 'D']) put(`${col}${row}`, undefined, { font: HEADING, border: { top: medium(top), bottom: medium(GREY) } })
  put(`E${row}`, undefined, { font: HEADING, border: { right: medium(), top: medium(top), bottom: medium(GREY) } })
  sheet.mergeCells(`B${row}:E${row}`)
  sheet.getRow(row).height = 16.2
}

const date = (y, m, d) => new Date(Date.UTC(y, m - 1, d))
const L = { left: medium() }
const R = { right: medium() }
const DIV = { right: thick }

band(4, 'Payslip')
companyRow(5, 'ABC Co Ltd', BLACK)
companyRow(6, '12 Example Street', GREY)
companyRow(7, 'Port Louis', GREY)
companyRow(8, 'BRN :  C1234567', GREY)

put('B9', undefined, { border: { left: medium(), bottom: medium() } })
put('C9', undefined, { border: { bottom: medium() } })
put('D9', undefined, { border: { bottom: medium() } })
put('E9', 'Pay period: September 2026', { font: HEADING, align: 'center', border: { right: medium(), bottom: medium() } })
sheet.getRow(9).height = 16.2
band(10, 'Employee Info ')

put('B11', 'Name : ', { font: BODY, border: L })
put('C11', 'DOE JANE', { font: BODY })
put('D11', 'Date of Employment : ', { font: BODY })
put('E11', date(2021, 3, 15), { font: BODY, border: R, align: 'left', numFmt: DATE })
put('B12', 'NIC : ', { font: BODY, border: L })
put('C12', 'X0000000000001', { font: BODY })
put('D12', undefined, { font: BODY })
put('E12', undefined, { font: BODY, border: R })
put('B13', undefined, { border: { left: medium(), bottom: medium() } })
put('C13', undefined, { border: { bottom: medium() } })
put('D13', undefined, { border: { bottom: medium() } })
put('E13', undefined, { border: { right: medium(), bottom: medium() } })

put('B14', 'Earnings ', { font: HEADING, align: 'center', border: { left: medium(), top: medium() } })
put('C14', undefined, { border: { right: thick, top: medium() } })
put('D14', 'Deductions ', { font: HEADING, align: 'center', border: { top: medium() } })
put('E14', undefined, { border: { right: medium(), top: medium() } })
sheet.mergeCells('B14:C14')
sheet.mergeCells('D14:E14')
sheet.getRow(14).height = 15.6

put('B15', undefined, { border: L })
put('C15', 'Rs ', { font: BODY, align: 'center', border: DIV })
put('D15', undefined)
put('E15', 'Rs', { font: BODY, align: 'center', border: R })

const amount = (address, value, border, numFmt = FMT_WHOLE) => put(address, value, { font: BODY, align: 'right', border, numFmt })
const label = (address, text) => put(address, text, { font: BODY, border: address.startsWith('B') ? L : {} })

// Rows 16 to 24: earnings on the left, deductions on the right.
label('B16', 'Basic Salary ')
put('C16', 18000, { border: DIV, numFmt: '#,##0' })
label('D16', 'Contributions ')
put('E16', undefined, { border: R })
label('B17', 'Govt Increment ')
amount('C17', 0, DIV)
put('D17', undefined, { font: BODY })
put('E17', undefined, { border: R })
label('B18', 'Transport Allowance ')
amount('C18', 2450, DIV)
label('D18', 'CSG ')
amount('E18', { formula: '(C16-E23-E24+C17)*1.5%', result: 270 }, R, FMT_WHOLE_2)
label('B19', 'Presence Bonus ')
amount('C19', 0, DIV)
label('D19', 'NSF ')
amount('E19', { formula: '(C16-E23-E24+C17)*1%', result: 180 }, R, FMT_WHOLE_2)
label('B20', 'Productivity Bonus ')
amount('C20', 0, DIV)
label('D20', 'PAYE ')
amount('E20', 0, R, FMT_WHOLE_2)
label('B21', 'Advance ')
amount('C21', 0, DIV)
put('D21', undefined)
put('E21', undefined, { border: R })
put('B22', undefined, { border: L })
put('C22', undefined, { border: DIV })
label('D22', 'Others Deductions : ')
put('E22', undefined, { border: R })
put('B23', undefined, { border: L })
put('C23', undefined, { border: DIV })
label('D23', 'Absences :')
amount('E23', 0, R, FMT_WHOLE_2)
put('B24', undefined, { border: L })
put('C24', undefined, { border: DIV })
label('D24', 'Lateness ')
amount('E24', 0, R, FMT_WHOLE_2)

for (const row of [25, 27, 28, 30, 33]) {
  put(`B${row}`, undefined, { border: L })
  put(`C${row}`, undefined, { border: DIV })
  put(`D${row}`, undefined)
  put(`E${row}`, undefined, { border: R })
}

label('B26', 'Total Earnings ')
amount('C26', { formula: 'C16+C18+C19+C20+C21+C17', result: 20450 }, DIV)
label('D26', 'Total Deductions ')
amount('E26', { formula: 'E18+E19+E23+E20+E24', result: 450 }, R, FMT_WHOLE_2)

put('B29', undefined, { border: L })
put('C29', undefined, { border: DIV })
label('D29', 'Net Pay : ')
amount('E29', { formula: 'C26-E26', result: 20000 }, R, FMT_WHOLE_2)

label('B31', 'Signature Employee : ')
put('C31', undefined, { border: DIV })
label('D31', 'Signature Employer : ')
put('E31', undefined, { border: R })
label('B32', 'Date : ')
put('C32', date(2026, 9, 28), { font: BODY, align: 'right', border: DIV, numFmt: DATE })
put('D32', undefined)
put('E32', undefined, { border: R })

put('B34', undefined, { border: { left: medium(), bottom: medium() } })
put('C34', undefined, { border: { right: thick, bottom: medium() } })
put('D34', undefined, { border: { bottom: medium() } })
put('E34', undefined, { border: { right: medium(), bottom: medium() } })

mkdirSync(dirname(out), { recursive: true })
await workbook.xlsx.writeFile(out)
console.log('Wrote', out)
