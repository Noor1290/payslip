import { Minus, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { multiply, parseDecimal, toText } from '../lib/decimal'
import {
  cellName,
  cellsOf,
  COMPANY_FIELDS,
  DATE_PIECES,
  formatFor,
  labelOf,
  MAX_TERMS,
  type CellFormat,
  type DateFormatPiece,
  type DatePiece,
  type SheetBody,
  type SheetCell,
  type Source,
  type Term,
} from '../lib/sheetBody'
import { writeDate, writeNumber } from '../lib/sheetFormats'
import { choiceOf, COMPANY_LABELS, SOURCE_LABELS, type SourceChoice } from '../lib/sheetWording'

/** The fields found in the payroll data, for the lists to choose from. */
export interface SheetKeys {
  identity: string[]
  figures: string[]
}

const CHOICES: SourceChoice[] = ['text', 'fixed', 'company', 'employee', 'payroll', 'calc', 'employment', 'month', 'today', 'field', 'empty']
/** A piece that Pay month has no use for: a month has no day. */
const DAY_PIECES: readonly DatePiece[] = ['D', 'DD']
const SAMPLE_DAY = '2021-03-15'
const PRESETS: { label: string; pieces: DateFormatPiece[] }[] = [
  { label: '15-Mar-21', pieces: [{ piece: 'D' }, { text: '-' }, { piece: 'MMM' }, { text: '-' }, { piece: 'YY' }] },
  { label: '15/03/2021', pieces: [{ piece: 'DD' }, { text: '/' }, { piece: 'MM' }, { text: '/' }, { piece: 'YYYY' }] },
  { label: 'March 2021', pieces: [{ piece: 'MMMM' }, { text: ' ' }, { piece: 'YYYY' }] },
]

function sourceFor(choice: SourceChoice, keys: SheetKeys, text: string): Source {
  switch (choice) {
    case 'text':
      return { type: 'text', value: text }
    case 'fixed':
      return { type: 'fixed', value: text }
    case 'company':
      return { type: 'company', field: 'name' }
    case 'employee':
      return { type: 'name' }
    case 'payroll':
      return { type: 'payroll', key: keys.figures[0] ?? 'Gross Pay' }
    case 'calc':
      return { type: 'calc', terms: [{ sign: 1, of: { type: 'column', key: keys.figures[0] ?? 'Gross Pay' }, times: null, round: 'none' }] }
    case 'employment':
    case 'month':
    case 'today':
      return { type: 'date', of: choice }
    case 'field':
      return { type: 'date', of: 'field', key: keys.identity[0] ?? 'Date of Employment' }
    case 'empty':
      return { type: 'empty' }
  }
}

/** A number typed by the user: "0.045", or "4.5%" for 0.045. Null when it is not one. */
export function readRate(text: string): string | null {
  const trimmed = text.trim()
  const percent = trimmed.endsWith('%')
  const value = parseDecimal(percent ? trimmed.slice(0, -1) : trimmed)
  if (!value) return null
  const result = percent ? multiply(value, parseDecimal('0.01')!) : value
  if (!result) return null
  const written = toText(result)
  return /^-?\d{1,12}(\.\d{1,8})?$/.test(written) ? written : null
}

function NumberText({ label, value, onChange, disabled, allowEmpty }: { label: string; value: string | null; onChange: (value: string | null) => void; disabled: boolean; allowEmpty: boolean }) {
  const [typed, setTyped] = useState(value ?? '')
  const [wrong, setWrong] = useState(false)
  const id = useId()
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input
        id={id}
        className="input input-sm num"
        value={typed}
        disabled={disabled}
        aria-invalid={wrong}
        onChange={(event) => {
          setTyped(event.target.value)
          if (allowEmpty && event.target.value.trim() === '') {
            setWrong(false)
            onChange(null)
            return
          }
          const read = readRate(event.target.value)
          setWrong(read === null)
          if (read !== null) onChange(read)
        }}
      />
      {wrong && <span className="field-error">Write a number, such as 0.045 or 4.5%.</span>}
    </label>
  )
}

function KeyInput({ label, value, options, onChange, disabled }: { label: string; value: string; options: string[]; onChange: (value: string) => void; disabled: boolean }) {
  const id = useId()
  const listId = useId()
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input id={id} className="input input-sm" list={listId} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </label>
  )
}

function CalcEditor({ body, cell, terms, once, keys, disabled, onChange, onOnce }: { body: SheetBody; cell: SheetCell; terms: Term[]; once: boolean; keys: SheetKeys; disabled: boolean; onChange: (terms: Term[]) => void; onOnce: (once: boolean) => void }) {
  const others = cellsOf(body).filter((found) => found.cell.id !== cell.id && found.cell.source.type !== 'empty')
  const set = (index: number, change: Partial<Term>) => onChange(terms.map((term, i) => (i === index ? { ...term, ...change } : term)))
  const [generation, setGeneration] = useState(0)
  const reshape = (next: Term[]) => {
    setGeneration(generation + 1)
    onChange(next)
  }
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <legend className="field-label px-1">Parts, worked out in order</legend>
      <label className="field">
        <span className="field-label">Rounding</span>
        <select className="input input-sm" value={once ? 'once' : 'parts'} disabled={disabled} onChange={(event) => onOnce(event.target.value === 'once')}>
          <option value="parts">Part by part, as set below</option>
          <option value="once">Add the exact values, round the total once</option>
        </select>
      </label>
      {terms.map((term, index) => (
        <div key={index} className="flex flex-col gap-2 border-b border-line pb-3 last:border-b-0 last:pb-0" data-testid="calc-part">
          <div className="flex flex-wrap items-end gap-2">
            <label className="field">
              <span className="field-label">Part {index + 1}</span>
              <select className="input input-sm" value={term.sign} disabled={disabled} onChange={(event) => set(index, { sign: Number(event.target.value) === -1 ? -1 : 1 })}>
                <option value={1}>Add</option>
                <option value={-1}>Subtract</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">What</span>
              <select
                className="input input-sm"
                value={term.of.type}
                disabled={disabled}
                onChange={(event) => {
                  const type = event.target.value
                  set(index, { of: type === 'cell' ? { type: 'cell', id: others[0]?.cell.id ?? cell.id } : type === 'number' ? { type: 'number', value: '0' } : { type: 'column', key: keys.figures[0] ?? 'Gross Pay' } })
                }}
              >
                <option value="column">Payroll figure</option>
                <option value="cell">Another cell</option>
                <option value="number">A number</option>
              </select>
            </label>
            {term.of.type === 'column' && <KeyInput label="Figure" value={term.of.key} options={keys.figures} disabled={disabled} onChange={(key) => set(index, { of: { type: 'column', key } })} />}
            {term.of.type === 'cell' && (
              <label className="field">
                <span className="field-label">Cell</span>
                <select className="input input-sm" value={term.of.id} disabled={disabled} onChange={(event) => set(index, { of: { type: 'cell', id: event.target.value } })}>
                  {!others.some((found) => found.cell.id === (term.of as { id: string }).id) && <option value={term.of.id}>This cell</option>}
                  {others.map((found) => (
                    <option key={found.cell.id} value={found.cell.id}>
                      {cellName(body, found.row, found.cell.col)} {labelOf(body, found.row, found.cell)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {term.of.type === 'number' && <NumberText key={`n${generation}-${index}`} label="Number" value={term.of.value} allowEmpty={false} disabled={disabled} onChange={(value) => value !== null && set(index, { of: { type: 'number', value } })} />}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <NumberText key={`r${generation}-${index}`} label="Multiplied by (optional)" value={term.times} allowEmpty disabled={disabled} onChange={(times) => set(index, { times })} />
            {!once && (
              <label className="field">
                <span className="field-label">Round this part first</span>
                <select className="input input-sm" value={term.round} disabled={disabled} onChange={(event) => set(index, { round: event.target.value as Term['round'] })}>
                  <option value="none">No</option>
                  <option value="whole">To whole rupees, half up</option>
                  <option value="two">To 2 decimals, half up</option>
                </select>
              </label>
            )}
            <button type="button" className="btn btn-sm btn-ghost" disabled={disabled || terms.length === 1} onClick={() => reshape(terms.filter((_, i) => i !== index))} aria-label={`Remove part ${index + 1}`}>
              <Minus aria-hidden="true" />
              Remove
            </button>
          </div>
        </div>
      ))}
      <div>
        <button type="button" className="btn btn-sm" disabled={disabled || terms.length >= MAX_TERMS} onClick={() => reshape([...terms, { sign: 1, of: { type: 'column', key: keys.figures[0] ?? 'Gross Pay' }, times: null, round: 'none' }])}>
          <Plus aria-hidden="true" />
          Add a part
        </button>
      </div>
    </fieldset>
  )
}

/** A date format built from pieces, with a live preview. */
function DateFormatEditor({ pieces, noDay, disabled, onChange }: { pieces: DateFormatPiece[]; noDay: boolean; disabled: boolean; onChange: (pieces: DateFormatPiece[]) => void }) {
  const offered = DATE_PIECES.filter((piece) => !noDay || !DAY_PIECES.includes(piece))
  const set = (index: number, next: DateFormatPiece) => onChange(pieces.map((one, i) => (i === index ? next : one)))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.filter((preset) => !noDay || !preset.pieces.some((one) => 'piece' in one && DAY_PIECES.includes(one.piece))).map((preset) => (
          <button key={preset.label} type="button" className="btn btn-sm" disabled={disabled} onClick={() => onChange(preset.pieces)}>
            {preset.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-1.5">
        {pieces.map((one, index) =>
          'piece' in one ? (
            <select key={index} className="input input-sm w-auto" aria-label={`Piece ${index + 1} of the date`} value={one.piece} disabled={disabled} onChange={(event) => set(index, { piece: event.target.value as DatePiece })}>
              {offered.map((piece) => (
                <option key={piece} value={piece}>
                  {piece}
                </option>
              ))}
            </select>
          ) : (
            <input
              key={index}
              className="input input-sm w-14 text-center"
              aria-label={`Separator ${index + 1} of the date`}
              value={one.text}
              maxLength={20}
              disabled={disabled}
              onChange={(event) => event.target.value !== '' && set(index, { text: event.target.value })}
            />
          ),
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn btn-sm btn-ghost" disabled={disabled || pieces.length >= 12} onClick={() => onChange([...pieces, { text: ' ' }, { piece: offered[0] }].slice(0, 12))}>
          <Plus aria-hidden="true" />
          Add a piece
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={disabled || pieces.length <= 1} onClick={() => onChange(pieces.slice(0, -2).length > 0 ? pieces.slice(0, -2) : pieces.slice(0, 1))}>
          <Minus aria-hidden="true" />
          Remove the last piece
        </button>
      </div>
      <p className="m-0 text-sm" data-testid="date-preview">
        15 March 2021 is written <span className="num font-medium">{writeDate(pieces, SAMPLE_DAY)}</span>
      </p>
    </div>
  )
}

function FormatEditor({ cell, disabled, onChange }: { cell: SheetCell; disabled: boolean; onChange: (format: CellFormat) => void }) {
  const { format } = cell
  const sample = parseDecimal('18750.5')!
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <legend className="field-label px-1">How it is written</legend>
      {format.type === 'text' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={format.capitals} disabled={disabled} onChange={(event) => onChange({ ...format, capitals: event.target.checked })} />
          In capitals
        </label>
      )}
      {format.type === 'number' && (
        <div className="flex flex-col gap-2 text-sm">
          <label className="field">
            <span className="field-label">Decimals</span>
            <select className="input input-sm" value={String(format.decimals)} disabled={disabled} onChange={(event) => onChange({ ...format, decimals: event.target.value === 'auto' ? 'auto' : event.target.value === '2' ? 2 : 0 })}>
              <option value="auto">None for a whole amount, otherwise 2</option>
              <option value="0">Whole rupees, half up</option>
              <option value="2">Always 2</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={format.thousands} disabled={disabled} onChange={(event) => onChange({ ...format, thousands: event.target.checked })} />
            Thousands separators
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={format.rs} disabled={disabled} onChange={(event) => onChange({ ...format, rs: event.target.checked })} />
            Write "Rs" before it
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={format.dash} disabled={disabled} onChange={(event) => onChange({ ...format, dash: event.target.checked })} />
            A dash for 0
          </label>
          <p className="m-0" data-testid="number-preview">
            18,750.50 is written <span className="num font-medium">{writeNumber(sample, format).text}</span>
          </p>
        </div>
      )}
      {format.type === 'date' && <DateFormatEditor pieces={format.pieces} noDay={cell.source.type === 'date' && cell.source.of === 'month'} disabled={disabled} onChange={(pieces) => onChange({ ...format, pieces })} />}
    </fieldset>
  )
}

export interface SheetCellEditorProps {
  body: SheetBody
  row: number
  cell: SheetCell
  title: string
  locked: boolean
  companyName: string
  ownValue: string | undefined
  keys: SheetKeys
  /** What the cell showed in the uploaded file, while a new upload is set up. */
  hint: string | undefined
  preview: { text: string; who: string; problem: string | null } | null
  onChange: (cell: SheetCell) => void
  onOwnChange: (value: string | undefined) => void
}

/** What goes in one cell, how it is written, and what it prints. */
export function SheetCellEditor(props: SheetCellEditorProps) {
  const { body, row, cell, title, locked, companyName, ownValue, keys, hint, preview, onChange, onOwnChange } = props
  const source = cell.source
  const setSource = (next: Source, keepFormat = true) => onChange({ ...cell, source: next, format: keepFormat ? cell.format : formatFor(next) })
  const setChoice = (next: SourceChoice) => {
    const text = source.type === 'text' || source.type === 'fixed' ? source.value : ''
    const made = sourceFor(next, keys, text)
    const { side: _side, label: _label, ...plain } = cell
    onChange({ ...plain, source: made, format: formatFor(made) })
  }
  const figure = source.type === 'payroll' || source.type === 'calc'

  return (
    <section className="card flex flex-col gap-4 p-4" aria-labelledby="sheet-cell-title" data-testid="sheet-cell-editor">
      <div>
        <h4 id="sheet-cell-title" className="m-0 text-base font-semibold">
          {title}
        </h4>
        {hint && (
          <p className="m-0 text-sm text-muted">
            In the uploaded file: <span className="num">{hint}</span>
          </p>
        )}
      </div>

      <label className="field">
        <span className="field-label">What goes in it</span>
        <select className="input input-sm" value={choiceOf(source)} disabled={locked} onChange={(event) => setChoice(event.target.value as SourceChoice)}>
          {CHOICES.map((one) => (
            <option key={one} value={one}>
              {SOURCE_LABELS[one]}
            </option>
          ))}
        </select>
      </label>

      {source.type === 'text' && (
        <label className="field">
          <span className="field-label">Text</span>
          <input className="input input-sm" value={source.value} maxLength={300} disabled={locked} onChange={(event) => setSource({ type: 'text', value: event.target.value })} />
        </label>
      )}

      {source.type === 'fixed' && (
        <div className="flex flex-col gap-3">
          <label className="field">
            <span className="field-label">Value for all companies</span>
            <input className="input input-sm" value={source.value} maxLength={300} disabled={locked} onChange={(event) => setSource({ type: 'fixed', value: event.target.value })} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ownValue !== undefined} disabled={locked} onChange={(event) => onOwnChange(event.target.checked ? source.value : undefined)} />
            {companyName} has its own value
          </label>
          {ownValue !== undefined && (
            <label className="field">
              <span className="field-label">Value for {companyName} only</span>
              <input className="input input-sm" value={ownValue} maxLength={300} disabled={locked} onChange={(event) => onOwnChange(event.target.value)} />
            </label>
          )}
          <p className="m-0 text-sm" data-testid="applies">
            <span className={`badge ${ownValue !== undefined ? 'tone-glow' : ''}`}>{ownValue !== undefined ? `${companyName} only` : 'All companies'}</span>
          </p>
        </div>
      )}

      {source.type === 'company' && (
        <label className="field">
          <span className="field-label">Detail</span>
          <select className="input input-sm" value={source.field} disabled={locked} onChange={(event) => setSource({ type: 'company', field: event.target.value as (typeof COMPANY_FIELDS)[number] })}>
            {COMPANY_FIELDS.map((field) => (
              <option key={field} value={field}>
                {COMPANY_LABELS[field]}
              </option>
            ))}
          </select>
        </label>
      )}

      {(source.type === 'name' || source.type === 'employee') && (
        <label className="field">
          <span className="field-label">Field</span>
          <select
            className="input input-sm"
            value={source.type === 'name' ? '' : source.key}
            disabled={locked}
            onChange={(event) => setSource(event.target.value === '' ? { type: 'name' } : { type: 'employee', key: event.target.value })}
          >
            <option value="">Full name</option>
            {[...new Set([...(source.type === 'employee' ? [source.key] : []), ...keys.identity])].map((key) => (
              <option key={key} value={key}>
                {key === 'ID' ? 'NIC (ID)' : key}
              </option>
            ))}
          </select>
        </label>
      )}

      {source.type === 'payroll' && <KeyInput label="Payroll figure" value={source.key} options={keys.figures} disabled={locked} onChange={(key) => setSource({ type: 'payroll', key })} />}

      {source.type === 'date' && source.of === 'field' && <KeyInput label="Date field" value={source.key ?? ''} options={keys.identity} disabled={locked} onChange={(key) => setSource({ type: 'date', of: 'field', ...(key.trim() ? { key } : {}) })} />}
      {source.type === 'date' && source.of === 'today' && <p className="m-0 text-sm text-muted">The date on the payslip, on the Payslips page. It starts on today.</p>}

      {source.type === 'calc' && (
        <CalcEditor
          body={body}
          cell={cell}
          terms={source.terms}
          once={source.once === true}
          keys={keys}
          disabled={locked}
          onChange={(terms) => setSource({ ...source, terms })}
          onOnce={(once) => setSource(once ? { type: 'calc', terms: source.terms.map((term) => ({ ...term, round: 'none' })), once: true } : { type: 'calc', terms: source.terms })}
        />
      )}

      {source.type !== 'empty' && <FormatEditor cell={cell} disabled={locked} onChange={(format) => onChange({ ...cell, format })} />}

      {figure && (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-3">
          <legend className="field-label px-1">For the month review</legend>
          <label className="field">
            <span className="field-label">Side of the payslip</span>
            <select
              className="input input-sm"
              value={cell.side ?? ''}
              disabled={locked}
              onChange={(event) => {
                const { side: _side, ...plain } = cell
                onChange(event.target.value === '' ? plain : { ...plain, side: event.target.value as 'earnings' | 'deductions' })
              }}
            >
              <option value="">Neither</option>
              <option value="earnings">Earnings</option>
              <option value="deductions">Deductions</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Name of this figure</span>
            <input
              className="input input-sm"
              maxLength={60}
              value={cell.label ?? ''}
              placeholder={labelOf(body, row, { ...cell, label: undefined } as SheetCell)}
              disabled={locked}
              onChange={(event) => {
                const { label: _label, ...plain } = cell
                onChange(event.target.value === '' ? plain : { ...plain, label: event.target.value })
              }}
            />
          </label>
        </fieldset>
      )}

      <div className="flex flex-col gap-1 rounded-lg border border-line p-3" data-testid="sheet-cell-preview">
        <span className="field-label">On the payslip</span>
        {preview ? (
          <>
            <code className="num text-sm">{preview.text === '' ? '(empty)' : preview.text}</code>
            <span className="field-hint">{preview.who}</span>
            {preview.problem && <span className="field-error">{preview.problem}</span>}
          </>
        ) : (
          <span className="field-hint">Get payroll data on the Payslips page to see this cell with real figures.</span>
        )}
      </div>
    </section>
  )
}
