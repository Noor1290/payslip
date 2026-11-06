// The "lines" of an issued payslip made from a layout of the owner's own file ("From your file"):
// LINES FORMAT 2. Like format 1 (issuedLines.ts), it holds everything needed to show the payslip
// again exactly as issued, and a reopened payslip is drawn from it alone: the page settings, the
// column widths, the merged blocks, the styles, and every cell as printed, with the size and the
// lines a long name or the address was fitted to, and the row heights that gave. Nothing is
// recalculated from payroll data, a layout or own values. Described in docs/ISSUED_PAYSLIP.md.
//
// Kept compact: a value that equals its default is left out.

import { z } from 'zod'
import { canonicalJson } from './hubWire'
import { unknownDrawing } from './layoutModel'
import { formatSchema, MAX_SHEET_COLUMNS, MAX_SHEET_ROWS, mergeSchema, styleSchema } from './sheetBody'
import type { IssuedFigures } from './issuedLines'
import { SHEET_DRAWING, type SheetDocCell, type SheetDocument } from './sheetDocument'

export const SHEET_LINES_FORMAT = 2
/** The drawing versions of these payslips that this app can draw. */
export const KNOWN_SHEET_DRAWINGS: readonly number[] = [SHEET_DRAWING]

/** A cell accepted as zero that is on neither side of the payslip, with the reason given. */
export interface ZeroCell {
  id: string
  label: string
  reason: string
}

export type SheetFigures = IssuedFigures & { zero: ZeroCell[] }

function encodeCell(cell: SheetDocCell): Record<string, unknown> {
  return {
    col: cell.col,
    style: cell.style,
    ...(cell.text === '' ? {} : { text: cell.text }),
    ...(cell.number === undefined ? {} : { number: cell.number }),
    ...(cell.iso === undefined ? {} : { iso: cell.iso }),
    ...(cell.format === undefined ? {} : { format: cell.format }),
    ...(cell.places === undefined ? {} : { places: cell.places }),
    ...(cell.size === undefined ? {} : { size: cell.size }),
    ...(cell.today ? { today: true } : {}),
  }
}

/** One payslip as the list of objects that is stored: a document object, a figures object, then one object per row. */
export function encodeSheetLines(document: SheetDocument, figures: SheetFigures): Record<string, unknown>[] {
  const { rows, kind: _kind, ...page } = document
  return [
    { kind: 'document', format: SHEET_LINES_FORMAT, ...page },
    {
      kind: 'figures',
      lines: figures.lines.map(({ status, ...line }) => ({ ...line, ...(status === 'ok' ? {} : { status }) })),
      totals: { ...figures.totals },
      ...(figures.zero.length === 0 ? {} : { zero: figures.zero.map((cell) => ({ ...cell })) }),
    },
    ...rows.map((row) => ({ height: row.height, ...(row.cells.length === 0 ? {} : { cells: row.cells.map(encodeCell) }) })),
  ]
}

const cents = z.number().int().min(-1e13).max(1e13)
const text = z.string().max(300)
const lineId = z.string().min(1).max(60)
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const documentSchema = z.strictObject({
  kind: z.literal('document'),
  format: z.literal(SHEET_LINES_FORMAT),
  template: z.strictObject({ id: z.string().min(1).max(60), version: z.string().min(1).max(40) }),
  drawing: z.number().int().min(1).max(1000),
  orientation: z.enum(['portrait', 'landscape']),
  margins: z.literal('narrow').optional(),
  fit: z.literal(false).optional(),
  firstRow: z.number().int().min(0).max(10_000),
  firstColumn: z.number().int().min(0).max(1_000),
  columns: z.array(z.number().min(0).max(255)).min(1).max(MAX_SHEET_COLUMNS),
  merges: z.array(mergeSchema).max(500),
  styles: z.array(styleSchema).min(1).max(400),
  employeeName: text,
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  dateOfEmployment: iso.optional(),
})

const figuresSchema = z.strictObject({
  kind: z.literal('figures'),
  lines: z
    .array(
      z.strictObject({
        id: lineId,
        label: text,
        side: z.enum(['earnings', 'deductions']),
        cents,
        source: z.string().max(120).nullable(),
        status: z.enum(['unmapped', 'treated-as-zero']).optional(),
        reason: z.string().min(1).max(300).optional(),
      }),
    )
    .max(MAX_SHEET_ROWS * MAX_SHEET_COLUMNS),
  totals: z.strictObject({ earnings: cents, deductions: cents, net: cents }),
  zero: z.array(z.strictObject({ id: lineId, label: text, reason: z.string().min(1).max(300) })).max(200).optional(),
})

const cellSchema = z.strictObject({
  col: z.number().int().min(0).max(MAX_SHEET_COLUMNS),
  style: z.number().int().min(0),
  text: z.string().min(1).max(600).optional(),
  number: z.number().finite().optional(),
  iso: iso.optional(),
  format: formatSchema.optional(),
  places: z.union([z.literal(0), z.literal(2)]).optional(),
  size: z.number().min(1).max(100).optional(),
  today: z.literal(true).optional(),
})

const rowSchema = z.strictObject({
  height: z.number().min(0).max(1000),
  cells: z.array(cellSchema).min(1).max(MAX_SHEET_COLUMNS).optional(),
})

export type DecodedSheetLines = { ok: true; document: SheetDocument; figures: SheetFigures } | { ok: false; problem: string }

const NOT_MATCHING = 'The stored payslip does not match its format. It is not shown, rather than guessed at.'

/** Reads stored lines of format 2 back into the document they were made from. Untrusted: checked first. */
export function decodeSheetLines(lines: readonly unknown[]): DecodedSheetLines {
  const document = documentSchema.safeParse(lines[0])
  const figures = figuresSchema.safeParse(lines[1])
  const rows = z.array(rowSchema).min(1).max(MAX_SHEET_ROWS).safeParse(lines.slice(2))
  if (!document.success || !figures.success || !rows.success) return { ok: false, problem: NOT_MATCHING }
  const { kind: _kind, format: _format, ...page } = document.data
  if (!KNOWN_SHEET_DRAWINGS.includes(page.drawing)) return { ok: false, problem: unknownDrawing(page.drawing) }
  // Every place it names must be inside the payslip: a style, a column, a merged block.
  const width = page.columns.length
  const inside =
    rows.data.every((row) => (row.cells ?? []).every((cell) => cell.col < width && cell.style < page.styles.length)) &&
    page.merges.every((merge) => merge.row + merge.rows <= rows.data.length && merge.col + merge.cols <= width)
  if (!inside) return { ok: false, problem: NOT_MATCHING }
  return {
    ok: true,
    document: {
      kind: 'sheet',
      ...page,
      rows: rows.data.map((row) => ({
        height: row.height,
        cells: (row.cells ?? []).map(({ text: printed, today, ...cell }): SheetDocCell => ({ ...cell, text: printed ?? '', ...(today ? { today } : {}) })),
      })),
    },
    figures: {
      lines: figures.data.lines.map(({ status, ...line }) => ({ ...line, status: status ?? 'ok' })),
      totals: figures.data.totals,
      zero: figures.data.zero ?? [],
    },
  }
}

/**
 * Stored lines of format 2 with today's date taken out: the date the payslip was made is not a
 * change to it (owner's decision, 2 November 2026). Everything else counts.
 */
function withoutToday(lines: readonly unknown[]): unknown[] {
  return lines.map((line, index) => {
    if (index < 2) return line
    const row = line as { cells?: { today?: unknown }[] } | null
    if (!Array.isArray(row?.cells)) return line
    return { ...row, cells: row.cells.map((cell) => (cell?.today === true ? { ...cell, text: '', iso: '' } : cell)) }
  })
}

/** Whether two stored payslips of format 2 are the same payslip, whatever order their keys are in and whatever day they were made. */
export function sameSheetLines(a: readonly unknown[], b: readonly unknown[]): boolean {
  return canonicalJson(withoutToday(a)) === canonicalJson(withoutToday(b))
}
