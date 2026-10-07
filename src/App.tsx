import { CircleAlert, Download, Inbox, LayoutTemplate, Moon, Percent, ReceiptText, Sun } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ImportDialog, type IncomingPayroll } from './components/ImportDialog'
import { preparePayslips } from './lib/build'
import { formatPeriod, todayIso } from './lib/dates'
import { HUB_APP_ID, mergePayroll, PAYROLL_RESULT, readHubPayload, readHubReply, type MergeResult } from './lib/hubBridge'
import { bridgePort } from './lib/hubWire'
import type { ImportedPayroll } from './lib/payrollFile'
import type { AcceptedChecks } from './lib/payslip'
import { loadRates, ratesForCrossCheck, type RatesState } from './lib/ratesStore'
import { isMonth } from './lib/statutoryRates'
import { useTemplates } from './lib/useTemplates'
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
  const [accepted, setAccepted] = useState<Record<number, AcceptedChecks>>({})
  const [treatAsZero, setTreatAsZero] = useState<Map<number, Set<string>>>(() => new Map())

  // Everything below only does something inside the Payroll Hub dashboard's frame. Opened on its
  // own, the bridge stays silent, nothing is ever waiting and no dashboard control is shown.
  const insideDashboard = window.PayrollHubBridge.isEmbedded()
  const [connected, setConnected] = useState(false)
  // Statutory rates: the bundled defaults when opened on its own, otherwise ONLY what the
  // dashboard returns for the company. Settings, not payroll figures; still memory only.
  const [rates, setRates] = useState<RatesState>(() => (insideDashboard ? { status: 'waiting' } : { status: 'standalone' }))
  const [ratesReload, setRatesReload] = useState(0)
  // Companies (by BRN) for which the dashboard said this user is not an admin: shown read-only.
  const [readOnlyBrns, setReadOnlyBrns] = useState<ReadonlySet<string>>(() => new Set())
  // The company every save is for: the one in the payroll data that is open.
  const brn = data?.company.brn ?? null
  // Data that was read and checked but not imported yet: from the dashboard, or a second file.
  // Kept in this state and nowhere else, so a reload or Discard is the end of it.
  const [incoming, setIncoming] = useState<IncomingPayroll | null>(null)
  // True once the import dialog for waiting dashboard data was closed without importing.
  const [previewClosed, setPreviewClosed] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [dashboardError, setDashboardError] = useState<string | null>(null)

  useEffect(() => {
    if (themeChosen) document.documentElement.dataset.theme = theme
  }, [theme, themeChosen])

  const offer = useCallback((next: ImportedPayroll, source: IncomingPayroll['source']) => {
    // Newer data replaces whatever was still waiting.
    setIncoming({ key: crypto.randomUUID(), source, data: next })
    setPreviewClosed(false)
    setDashboardError(null)
  }, [])

  // Throws when the rows cannot be used, which is what tells the dashboard "Not delivered".
  const receiveFromDashboard = useCallback((payload: unknown) => offer(readHubPayload(payload), 'dashboard'), [offer])

  useEffect(() => {
    window.PayrollHubBridge.init({ appId: HUB_APP_ID, onData: receiveFromDashboard })
    return window.PayrollHubBridge.onStatus(setConnected)
  }, [receiveFromDashboard])

  useEffect(() => {
    if (!insideDashboard || !connected) return
    let current = true
    setRates({ status: 'loading' })
    void loadRates(bridgePort, brn).then((result) => {
      // An answer for a company that is no longer the one open is dropped.
      if (!current) return
      setRates(result.ok ? { status: 'loaded', versions: result.versions, company: result.company } : { status: 'failed', failure: result.failure })
    })
    return () => {
      current = false
    }
  }, [insideDashboard, connected, brn, ratesReload])

  const readOnly = brn !== null && readOnlyBrns.has(brn)
  const markReadOnly = useCallback(() => {
    if (brn !== null) setReadOnlyBrns((previous) => new Set([...previous, brn]))
  }, [brn])
  // "Reload" asks the dashboard afresh, so a role that changed there is found by the next save.
  const forgetReadOnly = useCallback(() => {
    setReadOnlyBrns((previous) => new Set([...previous].filter((known) => known !== brn)))
  }, [brn])
  // Templates: the built-in one when opened on its own; inside the dashboard, the company's own.
  const templates = useTemplates({ embedded: insideDashboard, connected, brn, port: bridgePort, readOnly, onForbidden: markReadOnly })
  const { template, mapping } = templates.active

  // Unsaved template changes live in this tab's memory only: say so before the tab is closed.
  useEffect(() => {
    if (!templates.unsaved) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [templates.unsaved])

  const getFromDashboard = async () => {
    setRequesting(true)
    setDashboardError(null)
    const result = readHubReply(await window.PayrollHubBridge.requestData(PAYROLL_RESULT))
    setRequesting(false)
    if (result.ok) offer(result.data, 'dashboard')
    else setDashboardError(result.error)
  }

  const crossCheckRates = useMemo(() => ratesForCrossCheck(rates, period), [rates, period])
  const prepared = useMemo(
    () =>
      data && isMonth(period)
        ? preparePayslips(
            data,
            { template, mapping, rateVersions: crossCheckRates.versions, whyNoRates: crossCheckRates.whyNone, period, treatAsZero },
            issueDate,
          )
        : [],
    [data, period, template, mapping, crossCheckRates, treatAsZero, issueDate],
  )

  const loadData = (next: ImportedPayroll | null) => {
    // Replacing or clearing the data clears everything that was decided about the old data.
    setData(next)
    setAccepted({})
    setTreatAsZero(new Map())
    setPeriod(next?.period ?? '')
  }

  const merge: MergeResult | null = useMemo(() => {
    if (!data || !incoming) return null
    if (!isMonth(period)) return { ok: false, reason: 'Choose the pay month of the data already open first.' }
    return mergePayroll(data, period, incoming.data)
  }, [data, incoming, period])

  const importIncoming = (mode: 'add' | 'replace') => {
    if (!incoming) return
    // Adding keeps every existing row in place, so what was accepted for them still holds.
    if (mode === 'add' && merge?.ok) setData(merge.data)
    else loadData(incoming.data)
    setIncoming(null)
    setPreviewClosed(false)
  }

  const dialogOpen = incoming !== null && !previewClosed && screen === 'payslips'
  const closeDialog = () => {
    // A file the user chose is simply dropped; data from the dashboard keeps waiting.
    if (incoming?.source === 'file') setIncoming(null)
    else setPreviewClosed(true)
  }
  const waiting = incoming?.source === 'dashboard' ? incoming : null

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
              {id === 'template' && templates.unsaved && <span className="badge tone-warn">Unsaved</span>}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {insideDashboard && (
            <>
              <span className={`badge ${connected ? 'tone-accent' : ''}`} role="status">
                {connected ? 'Dashboard connected' : 'Waiting for the dashboard'}
              </span>
              <button type="button" className="btn btn-sm" onClick={() => void getFromDashboard()} disabled={requesting}>
                <Download aria-hidden="true" />
                {requesting ? 'Waiting for the dashboard' : 'Get from dashboard'}
              </button>
            </>
          )}
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
        {(dashboardError || waiting) && (
          <div className="mx-auto mb-4 flex max-w-[1500px] flex-col gap-3">
            {dashboardError && (
              <div className="panel tone-danger" role="alert">
                <CircleAlert aria-hidden="true" />
                <p className="m-0 text-sm">{dashboardError}</p>
              </div>
            )}
            {waiting && (
              <div className="card flex flex-wrap items-center gap-3 p-4" role="status" data-testid="waiting-notice">
                <span className="icon-tile" aria-hidden="true">
                  <Inbox />
                </span>
                <div className="min-w-48 flex-1">
                  <p className="m-0 font-semibold">Payroll data from the dashboard is waiting</p>
                  <p className="m-0 text-sm">
                    {[
                      `${waiting.data.rows.length} ${waiting.data.rows.length === 1 ? 'employee' : 'employees'}`,
                      waiting.data.period ? formatPeriod(waiting.data.period) : null,
                      waiting.data.company.name,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                  <p className="m-0 text-sm text-muted">
                    {dialogOpen
                      ? 'Check the preview to import it.'
                      : screen === 'payslips'
                        ? 'Not imported yet.'
                        : 'Open it on the Payslips page. You are asked before anything is imported.'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {!dialogOpen && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => {
                        setScreen('payslips')
                        setPreviewClosed(false)
                      }}
                    >
                      Review and import
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setIncoming(null)
                      setPreviewClosed(false)
                    }}
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {screen === 'payslips' && (
          <PayslipsScreen
            data={data}
            onData={loadData}
            onOfferImport={(next) => offer(next, 'file')}
            period={period}
            onPeriod={setPeriod}
            issueDate={issueDate}
            onIssueDate={setIssueDate}
            prepared={prepared}
            mapping={mapping}
            templateChip={templates.active.chip}
            templateKind={templates.active.kind}
            exportBlock={templates.active.exportBlock}
            onOpenTemplate={() => setScreen('template')}
            accepted={accepted}
            onAccepted={setAccepted}
            treatAsZero={treatAsZero}
            onTreatAsZero={setTreatAsZero}
          />
        )}
        {screen === 'template' && (
          <TemplateScreen
            data={data}
            embedded={insideDashboard}
            templates={{
              ...templates,
              reload: () => {
                forgetReadOnly()
                templates.reload()
              },
            }}
          />
        )}
        {screen === 'rates' && (
          <RatesScreen
            state={rates}
            port={bridgePort}
            period={period}
            brn={brn}
            readOnly={readOnly}
            onReload={() => {
              forgetReadOnly()
              setRatesReload((count) => count + 1)
            }}
            onVersions={(versions) => setRates((previous) => (previous.status === 'loaded' ? { ...previous, versions } : previous))}
            onForbidden={markReadOnly}
          />
        )}
      </main>

      {dialogOpen && incoming && (
        <ImportDialog
          key={incoming.key}
          incoming={incoming}
          existing={data ? { name: data.company.name, count: data.rows.length } : null}
          merge={merge}
          onImport={importIncoming}
          onClose={closeDialog}
        />
      )}
    </div>
  )
}
