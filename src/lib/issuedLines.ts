// The "lines" of an issued payslip: what the dashboard stores for one employee and returns
// exactly as sent. It holds everything needed to show the payslip again exactly as issued, so a
// reopened payslip is drawn from this alone, never recalculated from payroll data, a template or
// rates. The shape is described in docs/ISSUED_PAYSLIP.md; this file is the code of that document.
//
// Kept compact: a value that equals its default is left out.

import { z } from 'zod'
import type { DocCell, DocRow, PayslipDocument } from './layoutModel'
import type { PayslipComputation } from './payslip'

/** Goes up when the shape changes. A payslip in a format this app does not know is never guessed at. */
export const LINES_FORMAT = 1
/** The dashboard accepts 1 to 200 objects. */
export const MAX_LINE_OBJECTS = 200

export interface IssuedFigure {
  /** The line's id in its template: the same line in another month has the same id. */
  id: string
  label: string
  side: 'earnings' | 'deductions'
  /** The amount shown, in whole cents. */
  cents: number
  /** The payroll column the figure was copied from, or null for a line that is not mapped. */
  source: string | null
  status: 'ok' | 'unmapped' | 'treated-as-zero'
  /** For "treated-as-zero": why the missing figure was accepted as zero. */
  reason?: string
}

export interface IssuedFigures {
  lines: IssuedFigure[]
  /** The three totals as shown, in whole cents: the plain addition of the lines. */
  totals: { earnings: number; deductions: number; net: number }
}

/** The figures of a payslip that is ready, with the reason given for each figure accepted as zero. */
export function figuresOf(computation: PayslipComputation, zeroReasons: Readonly<Record<string, string>> = {}): IssuedFigures {
  if (!computation.totals) throw new Error('A payslip with a line in error has no figures to issue.')
  return {
    lines: computation.lines.map((line) => {
      if (line.status === 'error') throw new Error('A payslip with a line in error has no figures to issue.')
      const reason = line.status === 'treated-as-zero' ? zeroReasons[line.id]?.trim() : undefined
      return { id: line.id, label: line.label, side: line.side, cents: line.cents, source: line.sourceKey, status: line.status, ...(reason ? { reason } : {}) }
    }),
    totals: { ...computation.totals },
  }
}

const defaultAlign = (kind: DocCell['kind']) => (kind === 'money' ? 'right' : 'left')

function encodeCell(cell: DocCell): Record<string, unknown> {
  return {
    col: cell.col,
    text: cell.text,
    ...(cell.kind === 'text' ? {} : { kind: cell.kind }),
    ...(cell.span === 1 ? {} : { span: cell.span }),
    ...(cell.bold ? { bold: true } : {}),
    ...(cell.size === 11 ? {} : { size: cell.size }),
    ...(cell.align === defaultAlign(cell.kind) ? {} : { align: cell.align }),
    ...(cell.cents === undefined ? {} : { cents: cell.cents }),
    ...(cell.isoDate === undefined ? {} : { isoDate: cell.isoDate }),
    ...(cell.lineId === undefined ? {} : { lineId: cell.lineId }),
    ...(cell.formula === undefined ? {} : { formula: { op: cell.formula.op, lineIds: [...cell.formula.lineIds] } }),
  }
}

/** One payslip as the list of objects that is stored: a document object, a figures object, then one object per row. */
export function encodeLines(document: PayslipDocument, figures: IssuedFigures): Record<string, unknown>[] {
  const { rows, ...page } = document
  return [
    { kind: 'document', format: LINES_FORMAT, ...page },
    {
      kind: 'figures',
      lines: figures.lines.map(({ status, ...line }) => ({ ...line, ...(status === 'ok' ? {} : { status }) })),
      totals: { ...figures.totals },
    },
    // A row is the common case, so it carries no `kind`.
    ...rows.map((row) => ({
      id: row.id,
      ...(row.fill === null ? {} : { fill: row.fill }),
      ...(row.ruleBelow === null ? {} : { rule: row.ruleBelow }),
      ...(row.cells.length === 0 ? {} : { cells: row.cells.map(encodeCell) }),
    })),
  ]
}

const cents = z.number().int().min(-1e13).max(1e13)
const text = z.string().max(300)
const lineId = z.string().min(1).max(60)

const documentSchema = z.strictObject({
  kind: z.literal('document'),
  format: z.literal(LINES_FORMAT),
  template: z.strictObject({ id: z.string().min(1).max(60), version: z.string().min(1).max(40) }),
  page: z.strictObject({ size: z.literal('A4'), orientation: z.literal('portrait') }),
  fonts: z.strictObject({ excel: z.string().min(1).max(60), print: z.string().min(1).max(60) }),
  columnWidths: z.tuple([z.number().positive(), z.number().positive(), z.number().positive(), z.number().positive()]),
  firstExcelRow: z.number().int().min(1).max(100),
  dividerFromRowId: z.string().max(40),
  employeeName: text,
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
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
    .max(60),
  totals: z.strictObject({ earnings: cents, deductions: cents, net: cents }),
})

const cellSchema = z.strictObject({
  col: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  text,
  kind: z.enum(['money', 'date']).optional(),
  span: z.union([z.literal(2), z.literal(4)]).optional(),
  bold: z.literal(true).optional(),
  size: z.literal(12).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  cents: cents.optional(),
  isoDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lineId: lineId.optional(),
  formula: z.strictObject({ op: z.enum(['sum', 'subtract']), lineIds: z.array(lineId).max(60) }).optional(),
})

const rowSchema = z.strictObject({
  id: z.string().min(1).max(40),
  fill: z.string().regex(/^[0-9A-Fa-f]{6}$/).optional(),
  rule: z.enum(['black', 'grey']).optional(),
  cells: z.array(cellSchema).min(1).max(4).optional(),
})

function decodeCell(cell: z.infer<typeof cellSchema>): DocCell {
  const kind = cell.kind ?? 'text'
  const decoded: DocCell = {
    col: cell.col,
    span: cell.span ?? 1,
    kind,
    text: cell.text,
    bold: cell.bold ?? false,
    size: cell.size ?? 11,
    align: cell.align ?? defaultAlign(kind),
  }
  if (cell.cents !== undefined) decoded.cents = cell.cents
  if (cell.isoDate !== undefined) decoded.isoDate = cell.isoDate
  if (cell.lineId !== undefined) decoded.lineId = cell.lineId
  if (cell.formula !== undefined) decoded.formula = cell.formula
  return decoded
}

export type DecodedLines = { ok: true; document: PayslipDocument; figures: IssuedFigures } | { ok: false; problem: string }

/** Reads stored lines back into the layout model they were made from. Untrusted: checked first. */
export function decodeLines(lines: unknown): DecodedLines {
  if (!Array.isArray(lines) || lines.length < 3 || lines.length > MAX_LINE_OBJECTS) {
    return { ok: false, problem: 'The stored payslip is not in a shape this app can read.' }
  }
  const format = (lines[0] as { format?: unknown } | null)?.format
  if (format !== LINES_FORMAT) {
    return {
      ok: false,
      problem:
        typeof format === 'number' && format > LINES_FORMAT
          ? `This payslip was issued by a newer version of the app (format ${format}). This version reads format ${LINES_FORMAT}.`
          : 'This payslip was not issued by this app, or its format is not known. It is not shown, rather than guessed at.',
    }
  }
  const document = documentSchema.safeParse(lines[0])
  const figures = figuresSchema.safeParse(lines[1])
  const rows = z.array(rowSchema).safeParse(lines.slice(2))
  if (!document.success || !figures.success || !rows.success) {
    return { ok: false, problem: 'The stored payslip does not match its format. It is not shown, rather than guessed at.' }
  }
  const { kind: _kind, format: _format, ...page } = document.data
  const found: IssuedFigures = {
    lines: figures.data.lines.map(({ status, ...line }) => ({ ...line, status: status ?? 'ok' })),
    totals: figures.data.totals,
  }
  return {
    ok: true,
    document: {
      ...page,
      rows: rows.data.map((row): DocRow => ({ id: row.id, cells: (row.cells ?? []).map(decodeCell), fill: row.fill ?? null, ruleBelow: row.rule ?? null })),
    },
    figures: found,
  }
}
