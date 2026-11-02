// A fake Excel payslip layout, like the owner's current one: Payslip / company / address / BRN /
// Pay period, Employee Info, Earnings on the left, Deductions on the right, totals, Net Pay,
// signatures. Built here so that no real file is ever in the repo. Fake data only.

import ExcelJS from 'exceljs'

const BLUE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF66CCFF' } }
const MEDIUM = { style: 'medium', color: { argb: 'FF000000' } }

export async function fakeLayoutBytes() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Payslip', { pageSetup: { orientation: 'portrait', fitToPage: true } })
  sheet.getColumn(2).width = 28.8
  sheet.getColumn(3).width = 32.8
  sheet.getColumn(4).width = 35.7
  sheet.getColumn(5).width = 40.6
  const put = (ref, value, style = {}) => {
    const cell = sheet.getCell(ref)
    cell.value = value
    cell.style = { font: { name: 'Book Antiqua', size: 11 }, ...style }
  }
  const band = (row, text) => {
    sheet.mergeCells(`B${row}:E${row}`)
    put(`B${row}`, text, { font: { name: 'Book Antiqua', size: 12, bold: true }, fill: BLUE, alignment: { horizontal: 'center' } })
  }
  const centred = (row, text, bold = false) => {
    sheet.mergeCells(`B${row}:E${row}`)
    put(`B${row}`, text, { font: { name: 'Book Antiqua', size: 11, bold }, alignment: { horizontal: 'center' } })
  }
  band(4, 'Payslip')
  centred(5, 'ABC Co Ltd', true)
  centred(6, '1 Fake Street, Port Example')
  centred(7, 'BRN : C1234567')
  put('E8', 'Pay period: September 2026', { font: { name: 'Book Antiqua', size: 11, bold: true }, alignment: { horizontal: 'right' } })
  band(9, 'Employee Info')
  put('B10', 'Name :')
  put('C10', 'SAMPLE PERSON')
  put('D10', 'Date of Employment :')
  put('E10', new Date(Date.UTC(2021, 2, 15)), { numFmt: 'd-mmm-yy', font: { name: 'Book Antiqua', size: 11 } })
  put('B11', 'NIC :')
  put('C11', 'X0000000000099')
  sheet.mergeCells('B13:C13')
  sheet.mergeCells('D13:E13')
  put('B13', 'Earnings', { font: { name: 'Book Antiqua', size: 12, bold: true }, alignment: { horizontal: 'center' } })
  put('D13', 'Deductions', { font: { name: 'Book Antiqua', size: 12, bold: true }, alignment: { horizontal: 'center' } })
  put('B14', 'Basic Salary')
  put('C14', 18000, { numFmt: '#,##0', font: { name: 'Book Antiqua', size: 11 } })
  put('D14', 'CSG', { font: { name: 'Book Antiqua', size: 11, italic: true } })
  put('E14', 270)
  put('B15', 'Govt Increment')
  put('C15', 500)
  put('D15', 'NSF')
  put('E15', 180)
  put('B16', 'Allowances')
  put('C16', 0)
  put('D16', 'PAYE')
  put('E16', 0)
  put('B18', 'Total Earnings', { font: { name: 'Book Antiqua', size: 11, bold: true } })
  put('C18', { formula: 'C14+C15+C16', result: 18500 })
  put('D18', 'Total Deductions', { font: { name: 'Book Antiqua', size: 11, bold: true } })
  put('E18', { formula: 'E14+E15+E16', result: 450 })
  put('D20', 'Net Pay :', { font: { name: 'Book Antiqua', size: 12, bold: true } })
  put('E20', { formula: 'C18-E18', result: 18050 })
  put('B22', 'Signature Employee :')
  put('D22', 'Signature Employer :')
  put('B23', 'Date :')
  put('C23', new Date(Date.UTC(2026, 8, 30)), { numFmt: 'd-mmm-yy', font: { name: 'Book Antiqua', size: 11 } })
  for (const row of [4, 8, 9, 12, 19, 21, 24]) for (const col of ['B', 'C', 'D', 'E']) sheet.getCell(`${col}${row}`).border = { ...sheet.getCell(`${col}${row}`).border, bottom: MEDIUM }
  for (let row = 4; row <= 24; row++) {
    sheet.getCell(`B${row}`).border = { ...sheet.getCell(`B${row}`).border, left: MEDIUM }
    sheet.getCell(`E${row}`).border = { ...sheet.getCell(`E${row}`).border, right: MEDIUM }
    if (row >= 13) sheet.getCell(`C${row}`).border = { ...sheet.getCell(`C${row}`).border, right: { style: 'thick', color: { argb: 'FF000000' } } }
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}
