import { LayoutTemplate, Moon, Percent, ReceiptText, Sun } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_STATUTORY_RATES } from './data/defaultStatutoryRates'
import { preparePayslips } from './lib/build'
import { todayIso } from './lib/dates'
import type { ImportedPayroll } from './lib/payrollFile'
import type { AcceptedChecks } from './lib/payslip'
import { isMonth, type RatesVersion } from './lib/statutoryRates'
import { DEFAULT_TABLE_MAPPING, TABLE_TEMPLATE, type TemplateMapping } from './lib/template'
import { PayslipsScreen } from './screens/PayslipsScreen'
import { RatesScreen } from './screens/RatesScreen'
import { TemplateScreen } from './screens/TemplateScreen'

type Screen = 'payslips' | 'template' | 'rates'
type Theme = 'dark' | 'light'

const SCREENS: { id: Screen; label: string; icon: typeof ReceiptText }[] = [
  { id: 'payslips', label: 'Payslips', icon: ReceiptText },
  { id: 'template', label: 'Template', icon: LayoutTemplate },
  { id: 'rates', label: 'Statutory rates', icon: Percent },
]

function initialTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('payslips')
  // The theme is chosen inside this app and kept in memory only (nothing is stored in the browser).
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [themeChosen, setThemeChosen] = useState(false)

  // Payroll data and everything derived from it live in memory only.
  const [data, setData] = useState<ImportedPayroll | null>(null)
  const [period, setPeriod] = useState('')
  const [issueDate, setIssueDate] = useState(todayIso)
  const [mapping, setMapping] = useState<TemplateMapping>(DEFAULT_TABLE_MAPPING)
  const [rateVersions, setRateVersions] = useState<RatesVersion[]>(() => [...DEFAULT_STATUTORY_RATES])
  const [accepted, setAccepted] = useState<Record<number, AcceptedChecks>>({})
  const [treatAsZero, setTreatAsZero] = useState<Map<number, Set<string>>>(() => new Map())

  useEffect(() => {
    if (themeChosen) document.documentElement.dataset.theme = theme
  }, [theme, themeChosen])

  const prepared = useMemo(
    () =>
      data && isMonth(period)
        ? preparePayslips(data, { template: TABLE_TEMPLATE, mapping, rateVersions, period, treatAsZero }, issueDate)
        : [],
    [data, period, mapping, rateVersions, treatAsZero, issueDate],
  )

  const loadData = (next: ImportedPayroll | null) => {
    // Replacing or clearing the data clears everything that was decided about the old data.
    setData(next)
    setAccepted({})
    setTreatAsZero(new Map())
    setPeriod(next?.period ?? '')
  }

  return (
    <div className="relative flex h-full flex-col">
      <div className="backdrop" aria-hidden="true" />
      <div className="aurora aurora-a" aria-hidden="true" />
      <div className="aurora aurora-b" aria-hidden="true" />
      <div className="aurora aurora-c" aria-hidden="true" />

      <header className="relative z-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="icon-tile" aria-hidden="true">
            <ReceiptText />
          </span>
          <div>
            <h1 className="m-0 text-[19px] font-semibold tracking-tight">Payslip</h1>
            <p className="m-0 text-xs text-muted">Payroll Hub</p>
          </div>
        </div>
        <nav aria-label="Sections" className="flex gap-1">
          {SCREENS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`btn btn-sm ${screen === id ? '' : 'btn-ghost'}`}
              aria-current={screen === id ? 'page' : undefined}
              onClick={() => setScreen(id)}
            >
              <Icon aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        <div className="ml-auto">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setThemeChosen(true)
              setTheme(theme === 'dark' ? 'light' : 'dark')
            }}
          >
            {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
        </div>
      </header>

      <main className="relative z-10 min-h-0 flex-1 overflow-auto px-6 py-5">
        {screen === 'payslips' && (
          <PayslipsScreen
            data={data}
            onData={loadData}
            period={period}
            onPeriod={setPeriod}
            issueDate={issueDate}
            onIssueDate={setIssueDate}
            prepared={prepared}
            mapping={mapping}
            accepted={accepted}
            onAccepted={setAccepted}
            treatAsZero={treatAsZero}
            onTreatAsZero={setTreatAsZero}
          />
        )}
        {screen === 'template' && <TemplateScreen data={data} mapping={mapping} onMapping={setMapping} />}
        {screen === 'rates' && <RatesScreen versions={rateVersions} onVersions={setRateVersions} period={period} />}
      </main>
    </div>
  )
}
