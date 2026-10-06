import { Clock3, Info, Table2, TextSearch } from 'lucide-react'
import type { ImportedPayroll } from '../lib/payrollFile'
import { mappableKeys, TABLE_TEMPLATE, templateLines, type TemplateMapping } from '../lib/template'

interface Props {
  data: ImportedPayroll | null
  mapping: TemplateMapping
  onMapping: (mapping: TemplateMapping) => void
}

const hasValue = (row: Record<string, unknown>, key: string) => key in row && row[key] !== null && row[key] !== ''

export function TemplateScreen({ data, mapping, onMapping }: Props) {
  const keys = data ? mappableKeys(data.keys, data.rows, mapping) : []
  const lines = templateLines(TABLE_TEMPLATE)

  const setLineKey = (lineId: string, key: string | null) => {
    const previous = mapping.lines[lineId]
    onMapping({
      ...mapping,
      lines: {
        ...mapping.lines,
        // A new choice is the owner's own, so it is no longer "to confirm".
        [lineId]: { ...previous, key, toConfirm: previous.toConfirm && key === previous.key },
      },
    })
  }
  const setBase = (field: 'csgBase' | 'nsfBase', key: string) => {
    onMapping({
      ...mapping,
      crossCheck: {
        ...mapping.crossCheck,
        [field]: key,
        nsfBaseToConfirm: field === 'nsfBase' ? false : mapping.crossCheck.nsfBaseToConfirm,
      },
    })
  }

  const options = (current: string | null) => {
    const list = current && !keys.includes(current) ? [current, ...keys] : keys
    return list.map((key) => (
      <option key={key} value={key}>
        {key}
      </option>
    ))
  }

  return (
    <div className="rise-in mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <h2 className="m-0 text-2xl font-semibold tracking-tight">Template</h2>
        <p className="m-0 text-muted">How the payslip looks, and which payroll column fills each line.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card flex items-start gap-3 p-4" aria-current="true">
          <span className="icon-tile" aria-hidden="true">
            <Table2 />
          </span>
          <div className="min-w-0">
            <p className="m-0 flex flex-wrap items-center gap-2 font-semibold">
              Table <span className="badge tone-accent">In use</span>
            </p>
            <p className="m-0 text-sm text-muted">
              One A4 page: earnings on the left, deductions on the right, as in the reference.
            </p>
          </div>
        </div>
        <div className="card flex items-start gap-3 p-4 opacity-70" aria-disabled="true">
          <span className="icon-tile tone-glow" aria-hidden="true">
            <TextSearch />
          </span>
          <div className="min-w-0">
            <p className="m-0 flex flex-wrap items-center gap-2 font-semibold">
              Lookup{' '}
              <span className="badge">
                <Clock3 aria-hidden="true" />
                Coming soon
              </span>
            </p>
            <p className="m-0 text-sm text-muted">A workbook that fills the payslip from an employee ID. Not available yet.</p>
          </div>
        </div>
      </div>

      <section className="card" aria-label="Where each line comes from">
        <div className="card-header">
          <h3 className="card-title">Where each line comes from</h3>
          <span className="text-sm text-muted">{data ? `${keys.length} columns found in the data` : 'No data imported'}</span>
        </div>
        {!data && (
          <div className="panel tone-sky m-4">
            <Info aria-hidden="true" />
            <p className="m-0 text-sm">Import payroll data on the Payslips page to choose from the columns found in it.</p>
          </div>
        )}
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Payslip line</th>
                <th scope="col">Side</th>
                <th scope="col">Payroll column</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const lineMapping = mapping.lines[line.id]
                const selectId = `map-${line.id}`
                const missing =
                  data && lineMapping.key
                    ? data.rows.filter(
                        (row) =>
                          !hasValue(row, lineMapping.key!) && !(lineMapping.aliases ?? []).some((alias) => hasValue(row, alias)),
                      ).length
                    : 0
                const oldName =
                  data && lineMapping.key
                    ? data.rows.filter(
                        (row) =>
                          !hasValue(row, lineMapping.key!) && (lineMapping.aliases ?? []).some((alias) => hasValue(row, alias)),
                      ).length
                    : 0
                return (
                  <tr key={line.id}>
                    <th scope="row" className="!static !bg-transparent !text-fg !text-[13.5px]">
                      <label htmlFor={selectId}>{line.label}</label>
                    </th>
                    <td className="text-muted">{line.side === 'earnings' ? 'Earnings' : 'Deductions'}</td>
                    <td>
                      <select
                        id={selectId}
                        className="input input-sm w-full max-w-xs"
                        value={lineMapping.key ?? ''}
                        disabled={!data}
                        onChange={(event) => setLineKey(line.id, event.target.value === '' ? null : event.target.value)}
                      >
                        {!lineMapping.required && <option value="">Not mapped (shows "-")</option>}
                        {options(lineMapping.key)}
                      </select>
                    </td>
                    <td>
                      <span className="flex flex-wrap gap-1.5">
                        {lineMapping.toConfirm && <span className="badge tone-sky">To confirm</span>}
                        {lineMapping.required && <span className="badge">Required</span>}
                        {missing > 0 && (
                          <span className="badge tone-danger">
                            Missing for {missing} {missing === 1 ? 'employee' : 'employees'}
                          </span>
                        )}
                        {oldName > 0 && (
                          <span className="badge tone-warn">
                            Old name for {oldName} {oldName === 1 ? 'employee' : 'employees'}
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-label="Checks">
        <div className="card-header">
          <h3 className="card-title">Checks</h3>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div>
            <p className="m-0 text-sm font-medium">The three totals are compared with</p>
            <ul className="m-0 mt-1 list-disc pl-5 text-sm text-muted">
              <li>Total Earnings against {mapping.checks.gross}</li>
              <li>Total Deductions against {mapping.checks.deductions}</li>
              <li>Net Pay against {mapping.checks.net}</li>
            </ul>
          </div>
          <div className="flex flex-col gap-3">
            <div className="field">
              <label className="field-label" htmlFor="csg-base">
                CSG cross-check base
              </label>
              <select
                id="csg-base"
                className="input input-sm"
                value={mapping.crossCheck.csgBase}
                disabled={!data}
                onChange={(event) => setBase('csgBase', event.target.value)}
              >
                {options(mapping.crossCheck.csgBase)}
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="nsf-base">
                NSF cross-check base {mapping.crossCheck.nsfBaseToConfirm && <span className="badge tone-sky ml-1">To confirm</span>}
              </label>
              <select
                id="nsf-base"
                className="input input-sm"
                value={mapping.crossCheck.nsfBase}
                disabled={!data}
                onChange={(event) => setBase('nsfBase', event.target.value)}
              >
                {options(mapping.crossCheck.nsfBase)}
              </select>
            </div>
          </div>
          <p className="m-0 text-sm text-muted md:col-span-2">
            Never used on a payslip: {mapping.neverMap.join(', ')}. These are employer-side columns, or a second PAYE
            column.
          </p>
        </div>
      </section>
    </div>
  )
}
