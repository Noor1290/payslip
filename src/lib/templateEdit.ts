// The template editor's moves, as plain functions on a body: change a label, map a line, move a
// line, add or remove one. The editor is built from blocks, not free-form: these are the only
// changes it can make. The three totals and the fixed rules are not in the body, so none of
// these can touch them.

import { FIXED_LINES } from './template'
import { bodyRows, MAX_BODY_ROWS, type BodyLine, type TemplateBody } from './templateBody'

export type LabelKey = keyof TemplateBody['labels']
/** Where a line list sits: the earnings, or one deductions group. */
export type ListRef = { side: 'earnings' } | { side: 'deductions'; group: number }

const mapLists = (body: TemplateBody, change: (lines: BodyLine[]) => BodyLine[]): TemplateBody => ({
  ...body,
  earnings: change(body.earnings),
  deductionGroups: body.deductionGroups.map((group) => ({ ...group, lines: change(group.lines) })),
})

export function setLabel(body: TemplateBody, key: LabelKey, text: string): TemplateBody {
  return { ...body, labels: { ...body.labels, [key]: text } }
}

export function setLineLabel(body: TemplateBody, id: string, text: string): TemplateBody {
  return mapLists(body, (lines) => lines.map((line) => (line.id === id ? { ...line, label: text } : line)))
}

export function setGroupLabel(body: TemplateBody, group: number, text: string): TemplateBody {
  return { ...body, deductionGroups: body.deductionGroups.map((found, index) => (index === group ? { ...found, label: text } : found)) }
}

/** Maps a line to a payroll column, or to none. A new choice is the user's own: no longer "to confirm". */
export function setLineKey(body: TemplateBody, id: string, key: string | null): TemplateBody {
  const previous = body.mapping.lines[id]
  if (!previous) return body
  const keep = previous.toConfirm === true && previous.key === key
  return { ...body, mapping: { ...body.mapping, lines: { ...body.mapping.lines, [id]: { key, ...(keep ? { toConfirm: true } : {}) } } } }
}

export function setCrossCheckBase(body: TemplateBody, field: 'csgBase' | 'nsfBase', key: string): TemplateBody {
  const crossCheck = { ...body.mapping.crossCheck, [field]: key }
  if (field === 'nsfBase') crossCheck.nsfBaseToConfirm = false
  return { ...body, mapping: { ...body.mapping, crossCheck } }
}

/** Moves a line one place up (-1) or down (+1) inside its own list. */
export function moveLine(body: TemplateBody, id: string, delta: -1 | 1): TemplateBody {
  return mapLists(body, (lines) => {
    const from = lines.findIndex((line) => line.id === id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= lines.length) return lines
    const next = [...lines]
    ;[next[from], next[to]] = [next[to], next[from]]
    return next
  })
}

/** Employee CSG, Employee NSF and PAYE can never be removed. */
export function canRemoveLine(id: string): boolean {
  return !(id in FIXED_LINES)
}

export function removeLine(body: TemplateBody, id: string): TemplateBody {
  if (!canRemoveLine(id) || !(id in body.mapping.lines)) return body
  const lines = { ...body.mapping.lines }
  delete lines[id]
  const without = mapLists(body, (list) => list.filter((line) => line.id !== id))
  return { ...without, mapping: { ...body.mapping, lines } }
}

/** True while one more line in that list still fits on the page. */
export function canAddLine(body: TemplateBody, where: ListRef): boolean {
  return bodyRows(addLine(body, where, 'probe-line', true)) <= MAX_BODY_ROWS
}

/** Adds an unmapped line (it shows "-") at the end of a list. `id` must be new. */
export function addLine(body: TemplateBody, where: ListRef, id: string, force = false): TemplateBody {
  if (id in body.mapping.lines) return body
  const line: BodyLine = { id, label: 'New line' }
  const next: TemplateBody =
    where.side === 'earnings'
      ? { ...body, earnings: [...body.earnings, line] }
      : { ...body, deductionGroups: body.deductionGroups.map((group, index) => (index === where.group ? { ...group, lines: [...group.lines, line] } : group)) }
  const added = { ...next, mapping: { ...next.mapping, lines: { ...next.mapping.lines, [id]: { key: null } } } }
  return force || bodyRows(added) <= MAX_BODY_ROWS ? added : body
}

/** An id for a new line. */
export function newLineId(): string {
  return `line-${crypto.randomUUID().slice(0, 8)}`
}
