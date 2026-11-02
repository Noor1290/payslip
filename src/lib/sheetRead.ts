// Reads an uploaded Excel payslip layout into a "From your file" body: one sheet is one payslip.
// exceljs is already in the app for the Excel output; it is loaded only when a file is chosen.
//
// Only text typed in the file is kept. Numbers, dates and formulas start Empty, and what they
// showed is kept in this tab's memory as a hint while the layout is set up, never saved: it may be
// a real person's figure. Everything the app cannot keep is said in `notes`.

import type ExcelJS from 'exceljs'
import {
  columnName,
  formatFor,
  MAX_SHEET_COLUMNS,
  MAX_SHEET_ROWS,
  MAX_TEXT,
  SHEET_KIND,
  SHEET_SCHEMA,
  type BorderEdge,
  type SheetBody,
  type SheetCell,
  type SheetMerge,
  type SheetStyle,
} from './sheetBody'

export class SheetProblem extends Error {}

export interface SheetUpload {
  body: SheetBody
  /** What each Empty cell showed in the file, by cell id. In memory only. */
  hints: Readonly<Record<string, string>>
  /** What was left out or will look different. */
  notes: string[]
  name: string
}

const PRINT_FONT = 'TeX Gyre Pagella'
const DEFAULT_ROW_HEIGHT = 15
const DEFAULT_COLUMN_WIDTH = 8.43
const DEFAULT_FONT = { name: 'Calibri', size: 11 }

/** Excel's old 64-colour palette, for a colour saved by number. */
const INDEXED = '000000FFFFFFFF000000FF000000FFFFFF00FF00FF00FFFF000000FFFFFFFF000000FF000000FFFFFF00FF00FF00FFFF800000008000000080808000800080008080C0C0C0808080'
  + '9999FF993366FFFFCCCCFFFF660066FF80800066CCCCCCFF000080FF00FFFFFF0000FFFF800080800000008080'
  + '0000FF00CCFFCCFFFFCCFFCCFFFF9999CCFFCC99FFCC9999FFFFCC003366FF33CCCC99CC00FFCC00FF9900FF6600666699969696003366339966003300333300993300993366333399333333'

const indexed = (index: number) => {
  if (index === 64) return '000000'
  if (index === 65) return 'FFFFFF'
  const hex = INDEXED.slice(index * 6, index * 6 + 6)
  return hex.length === 6 ? hex : null
}

/** The twelve colours of the workbook's theme, in Excel's numbering. */
function themeColours(workbook: ExcelJS.Workbook): string[] {
  const model = workbook.model as unknown as { themes?: Record<string, string> }
  const xml = Object.values(model.themes ?? {})[0] ?? ''
  const read = (name: string) => {
    const part = new RegExp(`<a:${name}>([\\s\\S]*?)</a:${name}>`).exec(xml)?.[1] ?? ''
    return (/lastClr="([0-9A-Fa-f]{6})"/.exec(part)?.[1] ?? /srgbClr val="([0-9A-Fa-f]{6})"/.exec(part)?.[1] ?? '000000').toUpperCase()
  }
  return ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map(read)
}

/** A theme colour lightened or darkened as Excel does: in HLS, on the lightness. */
function withTint(hex: string, tint: number): string {
  const channel = (at: number) => parseInt(hex.slice(at, at + 2), 16) / 255
  const [r, g, b] = [channel(0), channel(2), channel(4)]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let lightness = (max + min) / 2
  const delta = max - min
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
  const hue = delta === 0 ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  lightness = tint < 0 ? lightness * (1 + tint) : lightness * (1 - tint) + tint
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = c * (1 - Math.abs((hue % 2) - 1))
  const m = lightness - c / 2
  const [a, d, e] = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x]
  const out = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, '0').toUpperCase()
  return `${out(a)}${out(d)}${out(e)}`
}

function colourReader(theme: readonly string[]) {
  return (colour: Partial<ExcelJS.Color> & { indexed?: number; tint?: number } | undefined): string | undefined => {
    if (!colour) return undefined
    if (colour.argb) return colour.argb.slice(-6).toUpperCase()
    if (colour.theme !== undefined) {
      const base = theme[colour.theme]
      if (!base) return undefined
      return colour.tint ? withTint(base, colour.tint) : base
    }
    if (colour.indexed !== undefined) return indexed(colour.indexed) ?? undefined
    return undefined
  }
}

const BORDERS: Record<string, BorderEdge['style']> = {
  thin: 'thin',
  medium: 'medium',
  thick: 'thick',
  hair: 'hair',
  dotted: 'dotted',
  dashed: 'dashed',
  double: 'double',
  mediumDashed: 'dashed',
  dashDot: 'dashed',
  mediumDashDot: 'dashed',
  dashDotDot: 'dashed',
  mediumDashDotDot: 'dashed',
  slantDashDot: 'dashed',
}

type Colour = ReturnType<typeof colourReader>

function styleOf(cell: ExcelJS.Cell, colour: Colour): SheetStyle {
  const { font, fill, border, alignment } = cell.style ?? {}
  const edge = (side: 'top' | 'left' | 'bottom' | 'right'): Partial<SheetStyle> => {
    const found = border?.[side]
    const style = found?.style ? BORDERS[found.style] : undefined
    return style ? { [side]: { style, color: colour(found?.color) ?? '000000' } } : {}
  }
  const fontColour = colour(font?.color)
  const fillColour = fill?.type === 'pattern' && fill.pattern !== 'none' ? colour(fill.fgColor) : undefined
  const horizontal = alignment?.horizontal
  const vertical = alignment?.vertical
  return {
    font: {
      name: font?.name ?? DEFAULT_FONT.name,
      size: font?.size ?? DEFAULT_FONT.size,
      ...(font?.bold ? { bold: true as const } : {}),
      ...(font?.italic ? { italic: true as const } : {}),
      ...(font?.underline ? { underline: true as const } : {}),
      ...(fontColour && fontColour !== '000000' ? { color: fontColour } : {}),
    },
    ...(fillColour ? { fill: fillColour } : {}),
    ...edge('top'),
    ...edge('left'),
    ...edge('bottom'),
    ...edge('right'),
    ...(horizontal === 'left' || horizontal === 'center' || horizontal === 'right' ? { horizontal } : {}),
    ...(vertical === 'top' || vertical === 'bottom' ? { vertical } : vertical === 'middle' ? { vertical: 'middle' as const } : {}),
    ...(alignment?.wrapText ? { wrap: true as const } : {}),
  }
}

const hasLook = (style: SheetStyle) => style.fill !== undefined || style.top !== undefined || style.left !== undefined || style.bottom !== undefined || style.right !== undefined

/** The text of a cell, when it is typed text. */
function typedText(value: ExcelJS.CellValue): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    if ('richText' in value) return value.richText.map((run) => run.text).join('')
    if ('hyperlink' in value && typeof value.text === 'string') return value.text
  }
  return null
}

/** What an Empty cell showed in the file: only a hint, kept in memory. */
function shown(cell: ExcelJS.Cell): string {
  try {
    return cell.text
  } catch {
    return ''
  }
}

const mergeRange = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/
const columnIndex = (letters: string) => [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1

/** Reads the first sheet of a workbook. Throws a SheetProblem with a sentence for the user. */
export async function readSheetFile(fileName: string, bytes: Uint8Array): Promise<SheetUpload> {
  const { default: ExcelJSRuntime } = await import('exceljs')
  const workbook = new ExcelJSRuntime.Workbook()
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer)
  } catch {
    throw new SheetProblem('This is not an Excel (.xlsx) file this app can read.')
  }
  const sheets = workbook.worksheets
  if (sheets.length === 0) throw new SheetProblem('The file has no sheets.')
  const sheet = sheets[0]
  const colour = colourReader(themeColours(workbook))
  const notes: string[] = []
  if (sheets.length > 1) notes.push(`The file has ${sheets.length} sheets. Only the first, "${sheet.name}", is used: one sheet is one payslip.`)
  if (sheet.getImages().length > 0) notes.push('Images and logos are left out: the dashboard does not store them in a template.')

  const merges: { top: number; left: number; bottom: number; right: number }[] = []
  for (const range of (sheet.model as unknown as { merges?: string[] }).merges ?? []) {
    const found = mergeRange.exec(range)
    if (found) merges.push({ left: columnIndex(found[1]), top: Number(found[2]) - 1, right: columnIndex(found[3]), bottom: Number(found[4]) - 1 })
  }

  // The grid is what has a value or a look; the empty edges of the sheet are not part of it.
  let [top, left, bottom, right] = [Infinity, Infinity, -1, -1]
  const lastRow = Math.min(sheet.rowCount, 1_000)
  const lastColumn = Math.min(sheet.columnCount, 200)
  for (let row = 1; row <= lastRow; row++) {
    for (let col = 1; col <= lastColumn; col++) {
      const cell = sheet.getRow(row).getCell(col)
      if (cell.value === null && !hasLook(styleOf(cell, colour))) continue
      top = Math.min(top, row - 1)
      left = Math.min(left, col - 1)
      bottom = Math.max(bottom, row - 1)
      right = Math.max(right, col - 1)
    }
  }
  if (bottom < 0) throw new SheetProblem('The first sheet is empty.')
  const rowCount = bottom - top + 1
  const columnCount = right - left + 1
  if (rowCount > MAX_SHEET_ROWS || columnCount > MAX_SHEET_COLUMNS) {
    throw new SheetProblem(`A payslip layout has at most ${MAX_SHEET_ROWS} rows and ${MAX_SHEET_COLUMNS} columns. This sheet has ${rowCount} rows and ${columnCount} columns.`)
  }

  const defaultWidth = sheet.properties.defaultColWidth ?? DEFAULT_COLUMN_WIDTH
  const defaultHeight = sheet.properties.defaultRowHeight ?? DEFAULT_ROW_HEIGHT
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const column = sheet.getColumn(left + index + 1)
    return column.hidden ? 0 : (column.width ?? defaultWidth)
  })

  const styles: SheetStyle[] = []
  const styleIndex = new Map<string, number>()
  const styleId = (style: SheetStyle) => {
    const key = JSON.stringify(style)
    let found = styleIndex.get(key)
    if (found === undefined) {
      found = styles.length
      styles.push(style)
      styleIndex.set(key, found)
    }
    return found
  }

  const hints: Record<string, string> = {}
  let nextId = 1
  let leftEmpty = 0
  let richText = false
  const usedFonts = new Set<string>()
  const isCovered = (row: number, col: number) => merges.some((merge) => row >= merge.top && row <= merge.bottom && col >= merge.left && col <= merge.right && !(row === merge.top && col === merge.left))

  const rows = Array.from({ length: rowCount }, (_, rowIndex) => {
    const sheetRow = sheet.getRow(top + rowIndex + 1)
    const cells: SheetCell[] = []
    for (let col = 0; col < columnCount; col++) {
      const cell = sheetRow.getCell(left + col + 1)
      const style = styleOf(cell, colour)
      const covered = isCovered(top + rowIndex, left + col)
      const value = covered ? null : cell.value
      if (value === null && !hasLook(style)) continue
      const typed = value === null ? null : typedText(value)
      if (typeof value === 'object' && value !== null && 'richText' in value) richText = true
      const id = `c${(nextId++).toString(36)}`
      const source = typed !== null && typed.trim() !== '' ? ({ type: 'text', value: typed.slice(0, MAX_TEXT) } as const) : ({ type: 'empty' } as const)
      if (value !== null && source.type === 'empty') {
        const hint = shown(cell)
        if (hint.trim() !== '') {
          hints[id] = hint
          leftEmpty += 1
        }
      }
      if (source.type === 'text') usedFonts.add(style.font.name)
      cells.push({ id, col, style: styleId(style), source, format: formatFor(source) })
    }
    return { height: sheetRow.hidden ? 0 : (sheetRow.height ?? defaultHeight), cells }
  })

  const kept: SheetMerge[] = merges
    .filter((merge) => merge.top >= top && merge.bottom <= bottom && merge.left >= left && merge.right <= right)
    .map((merge) => ({ row: merge.top - top, col: merge.left - left, rows: merge.bottom - merge.top + 1, cols: merge.right - merge.left + 1 }))

  if (leftEmpty > 0) notes.push(`${leftEmpty} ${leftEmpty === 1 ? 'cell with a number, date or formula starts' : 'cells with numbers, dates or formulas start'} Empty, so that no real figure is stored. Choose what goes in each one.`)
  if (richText) notes.push('Text with several styles in one cell keeps the style of the cell.')
  const others = [...usedFonts].filter((name) => name !== PRINT_FONT)
  if (others.length > 0) notes.push(`The preview and the PDF print ${others.join(', ')} in TeX Gyre Pagella, the font the app carries. The Excel output keeps your fonts.`)

  const body: SheetBody = {
    schema: SHEET_SCHEMA,
    kind: SHEET_KIND,
    orientation: sheet.pageSetup.orientation === 'landscape' ? 'landscape' : 'portrait',
    firstRow: top,
    firstColumn: left,
    columns,
    rows,
    merges: kept,
    styles: styles.length > 0 ? styles : [{ font: DEFAULT_FONT }],
  }
  const name = fileName.replace(/\.xlsx$/i, '').trim().slice(0, 80) || `Layout ${columnName(0)}`
  return { body, hints, notes, name }
}
