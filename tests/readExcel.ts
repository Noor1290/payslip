import ExcelJS from 'exceljs'

// Reads a generated workbook back. Shared by the Excel recordings and by the test that a
// format-1 payslip is always written the same way.

export interface CellRecord {
  value?: unknown
  formula?: string
  result?: unknown
  numFmt?: string
  font?: unknown
  fill?: unknown
  border?: unknown
  alignment?: unknown
}
export interface SheetRecord {
  name: string
  pageSetup: Record<string, unknown>
  columnWidths: Record<string, number | undefined>
  rowHeights: Record<string, number>
  merges: string[]
  cells: Record<string, CellRecord>
}

/** Reads the generated workbook back and keeps what matters: values, formulas and styles. */
export async function readWorkbook(bytes: Uint8Array): Promise<SheetRecord[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes.buffer as ArrayBuffer)
  return workbook.worksheets.map((sheet) => {
    const cells: Record<string, CellRecord> = {}
    const rowHeights: Record<string, number> = {}
    for (let r = 3; r <= 35; r++) {
      const row = sheet.getRow(r)
      if (row.height) rowHeights[r] = row.height
      for (const letter of ['A', 'B', 'C', 'D', 'E', 'F']) {
        const cell = sheet.getCell(`${letter}${r}`)
        const record: CellRecord = {}
        const value = cell.value as unknown
        const isMaster = !cell.isMerged || cell.master.address === cell.address
        if (value instanceof Date) record.value = value.toISOString()
        else if (value && typeof value === 'object' && 'formula' in value) {
          record.formula = (value as { formula: string }).formula
          record.result = (value as { result?: unknown }).result
        } else if (value !== null && value !== undefined && isMaster) record.value = value
        if (cell.numFmt && cell.numFmt !== 'General') record.numFmt = cell.numFmt
        if (cell.font && Object.keys(cell.font).length) record.font = cell.font
        if (cell.fill && cell.fill.type === 'pattern' && cell.fill.pattern !== 'none') record.fill = cell.fill
        if (cell.border && Object.keys(cell.border).length) record.border = cell.border
        if (cell.alignment && Object.keys(cell.alignment).length) record.alignment = cell.alignment
        if (Object.keys(record).length) cells[cell.address] = record
      }
    }
    const { paperSize, orientation, fitToPage, fitToWidth, fitToHeight, margins } = sheet.pageSetup
    return {
      name: sheet.name,
      pageSetup: { paperSize, orientation, fitToPage, fitToWidth, fitToHeight, margins },
      columnWidths: Object.fromEntries(['B', 'C', 'D', 'E'].map((l) => [l, sheet.getColumn(l).width])),
      rowHeights,
      merges: [...((sheet.model as unknown as { merges?: string[] }).merges ?? [])].sort(),
      cells,
    }
  })
}
