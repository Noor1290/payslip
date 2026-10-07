// The body of a stored payslip template: what the dashboard keeps as JSON and returns as sent.
// It holds labels, lines and which payroll column fills which line. Never a payroll figure, never
// an image. The three totals are not in it: they are always the plain addition of the lines shown.
//
// A body from the dashboard is untrusted: it is checked here before it is used, and a body that
// fails the schema, removes a required line or maps a never-map column is refused with a message
// naming the problem.

import { z } from 'zod'
import { canonicalJson, jsonBytes } from './hubWire'
import { normaliseKey } from './payrollFile'
import {
  DEFAULT_TABLE_MAPPING,
  FIXED_LINES,
  NEVER_MAP,
  RESERVED_LINE_IDS,
  TABLE_TEMPLATE,
  type PayslipTemplate,
  type TemplateMapping,
} from './template'

export const BODY_SCHEMA = 1
/** The dashboard's limit on a body, as JSON. */
export const BODY_MAX_BYTES = 150_000
export const NAME_MAX = 80
export const LABEL_MAX = 60
/** Rows between the "Rs" row and the totals that still fit on the one A4 page. */
export const MAX_BODY_ROWS = 20
export const MAX_GROUPS = 4

export interface BodyLine {
  id: string
  label: string
}
export interface BodyGroup {
  label: string
  gapAfterLabel?: boolean
  lines: BodyLine[]
}
export interface BodyLineMapping {
  /** The payroll column that fills the line, or null while it is unmapped (it shows "-"). */
  key: string | null
  toConfirm?: boolean
}
export interface TemplateBody {
  schema: typeof BODY_SCHEMA
  kind: 'table'
  labels: PayslipTemplate['labels']
  earnings: BodyLine[]
  deductionGroups: BodyGroup[]
  mapping: {
    lines: Record<string, BodyLineMapping>
    crossCheck: { csgBase: string; nsfBase: string; nsfBaseToConfirm: boolean }
  }
}

const label = z.string().max(LABEL_MAX)
const lineSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/),
  label: z.string().min(1).max(LABEL_MAX),
})
const columnName = z.string().min(1).max(120)

const bodySchema = z.strictObject({
  schema: z.literal(BODY_SCHEMA),
  kind: z.literal('table'),
  labels: z.strictObject({
    title: label,
    brnPrefix: label,
    payPeriodPrefix: label,
    employeeInfo: label,
    name: label,
    dateOfEmployment: label,
    nic: label,
    earnings: label,
    deductions: label,
    currency: label,
    totalEarnings: label,
    totalDeductions: label,
    netPay: label,
    signatureEmployee: label,
    signatureEmployer: label,
    date: label,
  }),
  earnings: z.array(lineSchema).min(1).max(MAX_BODY_ROWS),
  deductionGroups: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(LABEL_MAX),
        gapAfterLabel: z.boolean().optional(),
        lines: z.array(lineSchema).max(MAX_BODY_ROWS),
      }),
    )
    .min(1)
    .max(MAX_GROUPS),
  mapping: z.strictObject({
    lines: z.record(z.string(), z.strictObject({ key: columnName.nullable(), toConfirm: z.boolean().optional() })),
    crossCheck: z.strictObject({ csgBase: columnName, nsfBase: columnName, nsfBaseToConfirm: z.boolean() }),
  }),
})

/** The template and mapping the app works with, as the body that is stored. */
export function bodyOf(template: PayslipTemplate, mapping: TemplateMapping): TemplateBody {
  const line = ({ id, label: text }: BodyLine): BodyLine => ({ id, label: text })
  const lines: Record<string, BodyLineMapping> = {}
  for (const { id } of [...template.earnings, ...template.deductionGroups.flatMap((group) => group.lines)]) {
    const found = mapping.lines[id]
    lines[id] = { key: found?.key ?? null, ...(found?.toConfirm ? { toConfirm: true } : {}) }
  }
  return {
    schema: BODY_SCHEMA,
    kind: 'table',
    labels: { ...template.labels },
    earnings: template.earnings.map(line),
    deductionGroups: template.deductionGroups.map((group) => ({
      label: group.label,
      ...(group.gapAfterLabel ? { gapAfterLabel: true } : {}),
      lines: group.lines.map(line),
    })),
    mapping: {
      lines,
      crossCheck: {
        csgBase: mapping.crossCheck.csgBase,
        nsfBase: mapping.crossCheck.nsfBase,
        nsfBaseToConfirm: mapping.crossCheck.nsfBaseToConfirm,
      },
    },
  }
}

export interface TemplateIdentity {
  id: string
  name: string
  version: string
}

/** A checked body as the template and mapping the app works with. The fixed rules come from code. */
export function templateOf(body: TemplateBody, identity: TemplateIdentity): { template: PayslipTemplate; mapping: TemplateMapping } {
  const lines: TemplateMapping['lines'] = {}
  for (const [id, found] of Object.entries(body.mapping.lines)) {
    const fixed = FIXED_LINES[id]
    lines[id] = {
      key: found.key,
      ...(found.toConfirm ? { toConfirm: true } : {}),
      ...(fixed?.aliases ? { aliases: [...fixed.aliases] } : {}),
      ...(fixed?.required ? { required: true } : {}),
    }
  }
  return {
    template: {
      ...identity,
      labels: { ...body.labels },
      earnings: body.earnings.map((line) => ({ ...line, side: 'earnings' as const })),
      deductionGroups: body.deductionGroups.map((group) => ({
        label: group.label,
        ...(group.gapAfterLabel ? { gapAfterLabel: true } : {}),
        lines: group.lines.map((line) => ({ ...line, side: 'deductions' as const })),
      })),
    },
    mapping: {
      lines,
      checks: { ...DEFAULT_TABLE_MAPPING.checks },
      crossCheck: { ...body.mapping.crossCheck, aged60: DEFAULT_TABLE_MAPPING.crossCheck.aged60 },
      dateOfEmployment: DEFAULT_TABLE_MAPPING.dateOfEmployment,
      neverMap: [...NEVER_MAP],
    },
  }
}

/** The built-in Table template as a body: what "New template" starts from. */
export const BUILT_IN_BODY: TemplateBody = bodyOf(TABLE_TEMPLATE, DEFAULT_TABLE_MAPPING)

/** How many rows the lines take between the "Rs" row and the totals. */
export function bodyRows(body: Pick<TemplateBody, 'earnings' | 'deductionGroups'>): number {
  const right = body.deductionGroups.reduce(
    (rows, group, index) => rows + (index > 0 ? 1 : 0) + 1 + (group.gapAfterLabel ? 1 : 0) + group.lines.length,
    0,
  )
  return Math.max(body.earnings.length, right)
}

/** The dashboard refuses a body in which any text or key embeds a file (a `data:` URI). */
const EMBEDDED_FILE = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+/i

export function hasEmbeddedFile(value: unknown): boolean {
  const pending: unknown[] = [value]
  while (pending.length > 0) {
    const next = pending.pop()
    if (typeof next === 'string') {
      if (EMBEDDED_FILE.test(next)) return true
    } else if (Array.isArray(next)) {
      pending.push(...(next as unknown[]))
    } else if (typeof next === 'object' && next !== null) {
      for (const [key, inner] of Object.entries(next)) pending.push(key, inner)
    }
  }
  return false
}

/**
 * What is wrong with a body that already has the right shape. Empty when it can be used.
 * The editor shows the same list, so a template that would be refused on load cannot be saved.
 */
export function bodyProblems(body: TemplateBody): string[] {
  const problems: string[] = []
  const earnings = body.earnings
  const deductions = body.deductionGroups.flatMap((group) => group.lines)
  const all = [...earnings, ...deductions]

  const seen = new Set<string>()
  for (const line of all) {
    if (seen.has(line.id)) problems.push(`Two lines share the id "${line.id}" ("${line.label}").`)
    seen.add(line.id)
    if (RESERVED_LINE_IDS.includes(line.id) || line.id.startsWith('check-')) {
      problems.push(`The line "${line.label}" uses the id "${line.id}", which belongs to the totals.`)
    }
    if (line.label.trim() === '') problems.push('A line has an empty label.')
  }

  for (const [id, fixed] of Object.entries(FIXED_LINES)) {
    if (!deductions.some((line) => line.id === id)) {
      problems.push(`The ${fixed.name} line is missing from the deductions. Employee CSG, Employee NSF and PAYE cannot be removed.`)
    } else if (body.mapping.lines[id]?.key === null) {
      problems.push(`The ${fixed.name} line is not mapped to a payroll column.`)
    }
  }

  for (const line of all) {
    if (!(line.id in body.mapping.lines)) problems.push(`The line "${line.label}" has no mapping entry.`)
  }
  for (const id of Object.keys(body.mapping.lines)) {
    if (!seen.has(id)) problems.push(`There is a mapping for "${id}", which is not a line of this template.`)
  }

  const blocked = new Set(NEVER_MAP.map(normaliseKey))
  for (const line of all) {
    const key = body.mapping.lines[line.id]?.key
    if (key && blocked.has(normaliseKey(key))) {
      problems.push(
        `The line "${line.label}" is mapped to "${key}", a column that must never be on a payslip (employer side, or the second PAYE column).`,
      )
    }
  }

  const rows = bodyRows(body)
  if (rows > MAX_BODY_ROWS) problems.push(`The lines take ${rows} rows; only ${MAX_BODY_ROWS} fit on the page.`)
  if (hasEmbeddedFile(body)) problems.push('A template cannot contain images or other embedded files.')
  const bytes = jsonBytes(body)
  if (bytes > BODY_MAX_BYTES) problems.push(`The template is ${Math.ceil(bytes / 1000)} KB; the dashboard accepts at most 150 KB.`)
  return problems
}

export type BodyRead = { ok: true; body: TemplateBody } | { ok: false; problems: string[] }

/** Checks a body received from the dashboard. It is used only when this returns ok. */
export function readBody(raw: unknown): BodyRead {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, problems: ['The template body is not an object.'] }
  }
  const schema = (raw as { schema?: unknown }).schema
  if (schema !== BODY_SCHEMA) {
    return {
      ok: false,
      problems: [
        typeof schema === 'number' && schema > BODY_SCHEMA
          ? `This template was saved by a newer version of the app (format ${schema}). This version reads format ${BODY_SCHEMA}.`
          : 'This is not a payslip template this app can read (it has no known format number).',
      ],
    }
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.slice(0, 8).map((issue) => {
        const where = issue.path.join('.') || 'the template'
        return issue.code === 'unrecognized_keys' ? `Unexpected field in ${where}.` : `"${where}" is missing or not valid.`
      }),
    }
  }
  const body = parsed.data as TemplateBody
  const problems = bodyProblems(body)
  return problems.length > 0 ? { ok: false, problems } : { ok: true, body }
}

/** True when two bodies say the same thing, whatever order their keys are stored in. */
export function sameBody(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

/** What is wrong with a template name. Null when it can be used. `taken`: names already in use. */
export function nameProblem(name: string, taken: readonly string[] = []): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'Give the template a name.'
  if (trimmed.length > NAME_MAX) return `Keep the name to ${NAME_MAX} characters or fewer.`
  if (taken.some((other) => other.trim().toLowerCase() === trimmed.toLowerCase())) {
    return 'This company already has a template with that name.'
  }
  return null
}

export interface BodyChange {
  /** What changed, in words: the label of a line, its payroll column, its place... */
  what: string
  before: string
  after: string
}

/** The differences between two bodies, in words. Used to show what changed, never to merge. */
export function bodyChanges(before: TemplateBody, after: TemplateBody): BodyChange[] {
  const changes: BodyChange[] = []
  const add = (what: string, a: string, b: string) => {
    if (a !== b) changes.push({ what, before: a, after: b })
  }
  for (const key of Object.keys(TABLE_TEMPLATE.labels) as (keyof TemplateBody['labels'])[]) {
    add(`Label "${TABLE_TEMPLATE.labels[key].trim() || key}"`, before.labels[key], after.labels[key])
  }
  const describe = (body: TemplateBody) => {
    const lines = new Map<string, { label: string; place: string; key: string }>()
    const put = (line: BodyLine, place: string) =>
      lines.set(line.id, { label: line.label, place, key: body.mapping.lines[line.id]?.key ?? 'Not mapped' })
    body.earnings.forEach((line) => put(line, 'Earnings'))
    body.deductionGroups.forEach((group) => group.lines.forEach((line) => put(line, `Deductions, ${group.label}`)))
    return lines
  }
  const [a, b] = [describe(before), describe(after)]
  let moved = false
  for (const [id, line] of a) {
    const other = b.get(id)
    if (!other) {
      changes.push({ what: `Line "${line.label}"`, before: `In ${line.place}`, after: 'Removed' })
      continue
    }
    add(`Label of the line "${line.label}"`, line.label, other.label)
    add(`Payroll column of "${line.label}"`, line.key, other.key)
    add(`Place of "${line.label}"`, line.place, other.place)
    moved ||= line.place !== other.place
  }
  for (const [id, line] of b) {
    if (!a.has(id)) changes.push({ what: `Line "${line.label}"`, before: 'Not there', after: `Added to ${line.place}, column: ${line.key}` })
  }
  const order = (body: TemplateBody) =>
    [body.earnings, ...body.deductionGroups.map((group) => group.lines)].map((list) => list.map((line) => line.id).join(',')).join('|')
  const names = (body: TemplateBody) =>
    [body.earnings, ...body.deductionGroups.map((group) => group.lines)].map((list) => list.map((line) => line.label).join(', ')).join(' | ')
  const sameLines = a.size === b.size && [...a.keys()].every((id) => b.has(id))
  if (sameLines && !moved && order(before) !== order(after)) {
    changes.push({ what: 'Order of the lines', before: names(before), after: names(after) })
  }
  add('Deduction groups', before.deductionGroups.map((g) => g.label).join(', '), after.deductionGroups.map((g) => g.label).join(', '))
  add('CSG cross-check base', before.mapping.crossCheck.csgBase, after.mapping.crossCheck.csgBase)
  add('NSF cross-check base', before.mapping.crossCheck.nsfBase, after.mapping.crossCheck.nsfBase)
  return changes
}
