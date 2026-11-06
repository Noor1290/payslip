import { CircleAlert, TriangleAlert } from 'lucide-react'
import type { SheetBody } from '../lib/sheetBody'
import { TOO_LARGE_AT_FULL_SIZE } from '../lib/sheetDocument'
import { pageOf, SMALL_PRINT_SCALE } from '../writers/sheetGeometry'

/** The print scale in whole percent, rounded down so that 84.9% never reads as 85%. */
export const percentOf = (scale: number) => Math.floor(scale * 100 + 1e-9)

/** What the page settings say about the size the sheet prints at. */
export function scaleWords(body: SheetBody): { text: string; warning: string | null; tooLarge: string | null } {
  const page = pageOf(body)
  if (!page.fits) return { text: 'It prints at 100% of its size in Excel.', warning: null, tooLarge: TOO_LARGE_AT_FULL_SIZE }
  const percent = percentOf(page.scale)
  const text = `It prints at ${percent}% of its size in Excel.`
  if (page.scale >= SMALL_PRINT_SCALE) return { text, warning: null, tooLarge: null }
  const eleven = (Math.round(11 * page.scale * 10) / 10).toFixed(1).replace(/\.0$/, '')
  return {
    text,
    warning: `Below 85%, the payslip prints small: 11-point text prints at about ${eleven} points. Try narrow margins or landscape, or make the columns narrower in Excel.`,
    tooLarge: null,
  }
}

/** Orientation, margins and fitting to one page, with the size the sheet prints at. */
export function SheetPageSettings({ body, locked, onChange }: { body: SheetBody; locked: boolean; onChange: (change: (body: SheetBody) => SheetBody) => void }) {
  const words = scaleWords(body)
  return (
    <section className="card flex flex-col gap-3 p-4" aria-labelledby="sheet-page-title" data-testid="sheet-page">
      <h4 id="sheet-page-title" className="m-0 text-base font-semibold">
        Page
      </h4>
      <div className="flex flex-wrap items-end gap-4">
        <label className="field">
          <span className="field-label">Orientation</span>
          <select className="input input-sm" value={body.orientation} disabled={locked} onChange={(event) => onChange((current) => ({ ...current, orientation: event.target.value as SheetBody['orientation'] }))}>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Margins</span>
          <select
            className="input input-sm"
            value={body.margins ?? 'normal'}
            disabled={locked}
            onChange={(event) =>
              onChange(({ margins: _margins, ...current }) => (event.target.value === 'narrow' ? { ...current, margins: 'narrow' } : current))
            }
          >
            <option value="normal">Normal</option>
            <option value="narrow">Narrow</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-1 text-sm">
          <input
            type="checkbox"
            checked={body.fit !== false}
            disabled={locked}
            onChange={(event) => onChange(({ fit: _fit, ...current }) => (event.target.checked ? current : { ...current, fit: false }))}
          />
          Fit the sheet on one page
        </label>
      </div>
      <p className="m-0 text-sm" data-testid="sheet-scale">
        {words.text}
      </p>
      {words.warning && (
        <div className="panel tone-warn" role="status" data-testid="sheet-small-print">
          <TriangleAlert aria-hidden="true" />
          <p className="m-0 text-sm">{words.warning}</p>
        </div>
      )}
      {words.tooLarge && (
        <div className="panel tone-danger" role="alert" data-testid="sheet-too-large">
          <CircleAlert aria-hidden="true" />
          <p className="m-0 text-sm">{words.tooLarge}</p>
        </div>
      )}
    </section>
  )
}
