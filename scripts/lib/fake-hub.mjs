// A stand-in for the Payroll Hub dashboard's side of "statutory-rates", "payslip-template" and
// "payslip-issue", and of a request for one month's saved "payroll-result",
// kept in memory, for the tests and for scripts/check-bridge.mjs. It follows the wire contract in
// docs/INTEGRATION.md: strict fields, one row per save, expected_revision, the refusal codes.
// Everything in it is invented (ABC Co Ltd).
//
// createFakeHub is self-contained on purpose (no imports, nothing from the module scope): the
// bridge check pastes its source into the fake dashboard page.

export function createFakeHub() {
  const state = {
    signedIn: true,
    role: 'admin',
    company: { name: 'ABC Co Ltd', brn: 'C1234567' },
    /** Stored rates versions: wire fields plus `by` ("you" or "other"). */
    rates: [],
    /** Stored templates: { id, name, body, revision, updatedAt, by }. */
    templates: [],
    /** Published versions: { templateId, version, name, body, publishedAt, by }. */
    versions: [],
    /** The password gate. Issued payslips need it open. */
    gateOpen: true,
    /** What the dashboard user answers when asked to send issued payslips: allow, deny, timeout. */
    prompt: 'allow',
    /** National IDs of the current employees, or null when everyone is known. */
    employees: null,
    /** Issued payslips: wire fields plus `period` and `by`. Never changed, never removed. */
    issued: [],
    /** Saved payroll runs, by month ("2026-08"): the rows of the payroll export. */
    runs: {},
    /** Every message handled, in order: { type, payload }. */
    log: [],
    /**
     * What happens to the NEXT save only:
     *   { mode: 'lost' }               stored, but no answer comes back
     *   { mode: 'lost-unsaved' }       not stored, and no answer comes back
     *   { mode: 'unavailable' }        stored, answered "unavailable" (not confirmed in time)
     *   { mode: 'unavailable-unsaved' } not stored, answered "unavailable"
     *   { mode: 'refuse', code }       not stored, refused with that code
     */
    nextSave: null,
    /** What happens to the NEXT request only: { mode: 'lost' } or { mode: 'refuse', code }. */
    nextRequest: null,
    ticks: 0,
  }

  const SENTENCES = {
    stale: 'It was saved by someone else since you loaded it. Reload, then make the change again.',
    'no-change': 'Nothing was saved: this is the same as what is already stored.',
    forbidden: 'Only an admin of this company can do this.',
    'wrong-company': 'The dashboard has a different company selected. Select the same company there, then try again.',
    invalid: 'The data is not valid.',
    'not-found': 'The dashboard has no such item.',
    'too-large': 'It is too large to store.',
    unavailable: 'The dashboard could not confirm the save in time.',
    locked: 'The dashboard is locked, so nothing was issued. Confirm your password there, then issue again.',
    denied: 'The request was declined.',
    timeout: 'Nobody answered in time.',
  }
  const refuse = (code, error) => ({ ok: false, code, error: error ?? SENTENCES[code] })
  const field = (name) => refuse('invalid', `"${name}" is missing or not valid.`)
  const copy = (value) => JSON.parse(JSON.stringify(value))
  const stamp = () => `2026-10-07T09:${String(Math.floor(state.ticks / 60)).padStart(2, '0')}:${String(state.ticks++ % 60).padStart(2, '0')}+04:00`
  const norm = (brn) => String(brn).trim().toUpperCase()
  const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  const EMBEDDED = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+/i
  const bytes = (value) => new TextEncoder().encode(JSON.stringify(value) ?? '').length
  const sortKeys = (value) =>
    Array.isArray(value)
      ? value.map(sortKeys)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]))
        : value
  const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
  const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
  const unknownKey = (row, allowed) => Object.keys(row).find((key) => !allowed.includes(key))
  const decimals = (places) => (value) => Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) < 1e-6
  const hasFile = (value) =>
    typeof value === 'string'
      ? EMBEDDED.test(value)
      : Array.isArray(value)
        ? value.some(hasFile)
        : isObject(value) && Object.entries(value).some(([key, inner]) => EMBEDDED.test(key) || hasFile(inner))

  /** The selected company, or the refusal. A BRN, when given, must be the selected company's. */
  const context = (brn) => {
    if (!state.signedIn || !state.company) return refuse('unavailable', 'Nobody is signed in to the dashboard, or no company is selected.')
    if (brn !== undefined && (!state.company.brn || norm(state.company.brn) !== norm(brn))) return refuse('wrong-company')
    return null
  }
  const meta = () => ({ label: state.company.name, ...(state.company.brn ? { brn: state.company.brn } : {}), role: state.role === 'admin' ? 'admin' : 'member' })
  const brnProblem = (brn, required) =>
    brn === undefined ? required : typeof brn !== 'string' || brn.trim() === '' || brn.length > 50

  // ---------- statutory-rates ----------

  const RATE_KEYS = ['nsf_employee_rate', 'csg_employee_rate_low', 'csg_employee_rate_high']
  const AMOUNT_KEYS = ['nsf_ceiling', 'csg_threshold']
  const RATES_SAVE_KEYS = ['brn', 'effective_from', 'expected_revision', 'nsf_exempt_at_60', 'source_note', ...RATE_KEYS, ...AMOUNT_KEYS]

  const latestRates = (month) =>
    state.rates.filter((row) => row.effective_from === month).reduce((best, row) => (!best || row.revision > best.revision ? row : best), null)

  const answerRates = (params) => {
    if (params !== undefined) {
      if (!isObject(params)) return field('params')
      const extra = unknownKey(params, ['brn'])
      if (extra) return refuse('invalid', 'Unexpected field in the data.')
      if (brnProblem(params.brn, false)) return field('brn')
    }
    const refusal = context(params?.brn)
    if (refusal) return refusal
    const rows = [...state.rates]
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.revision - a.revision)
      .map(({ by, ...row }) => ({ ...row, created_by_you: by === 'you' }))
    return { ok: true, dataType: 'statutory-rates', rows, meta: meta() }
  }

  const checkRatesSave = (row) => {
    if (!isObject(row)) return field('row')
    if (unknownKey(row, RATES_SAVE_KEYS)) return refuse('invalid', 'Unexpected field in the data.')
    if (brnProblem(row.brn, true)) return field('brn')
    if (typeof row.effective_from !== 'string' || !MONTH.test(row.effective_from)) return field('effective_from')
    if (!Number.isInteger(row.expected_revision) || row.expected_revision < 0) return field('expected_revision')
    for (const key of RATE_KEYS) {
      if (typeof row[key] !== 'number' || !(row[key] >= 0 && row[key] <= 100) || !decimals(4)(row[key])) return field(key)
    }
    for (const key of AMOUNT_KEYS) {
      if (typeof row[key] !== 'number' || !(row[key] >= 0 && row[key] <= 9_999_999_999.99) || !decimals(2)(row[key])) return field(key)
    }
    if (typeof row.nsf_exempt_at_60 !== 'boolean') return field('nsf_exempt_at_60')
    if (row.source_note !== undefined && row.source_note !== null && (typeof row.source_note !== 'string' || row.source_note.trim().length > 300)) {
      return field('source_note')
    }
    const refusal = context(row.brn)
    if (refusal) return refusal
    if (state.role !== 'admin') return refuse('forbidden', 'Only an admin of this company can save statutory rates.')
    const latest = latestRates(row.effective_from)
    if ((latest?.revision ?? 0) !== row.expected_revision) return refuse('stale')
    const note = (typeof row.source_note === 'string' ? row.source_note.trim() : '') || null
    const values = [...RATE_KEYS, ...AMOUNT_KEYS, 'nsf_exempt_at_60']
    if (latest && values.every((key) => latest[key] === row[key]) && latest.source_note === note) return refuse('no-change')
    if (state.rates.length >= 1000) return refuse('too-large', 'The company has reached the limit for this kind of data.')
    return {
      store: () => {
        const stored = { effective_from: row.effective_from, revision: (latest?.revision ?? 0) + 1, source_note: note, created_at: stamp(), by: 'you' }
        for (const key of values) stored[key] = row[key]
        state.rates.push(stored)
        return { effective_from: stored.effective_from, revision: stored.revision }
      },
    }
  }

  // ---------- payslip-template ----------

  const latestVersion = (templateId) =>
    state.versions.filter((row) => row.templateId === templateId).reduce((best, row) => (!best || row.version > best.version ? row : best), null)
  const nextId = () => `20000000-0000-4000-8000-${String(state.templates.length + 1).padStart(12, '0')}`

  const answerTemplates = (params) => {
    if (!isObject(params)) return field('action')
    if (params.action !== 'list' && params.action !== 'load') return field('action')
    const allowed = params.action === 'list' ? ['action', 'brn'] : ['action', 'brn', 'template_id', 'version']
    if (unknownKey(params, allowed)) return refuse('invalid', 'Unexpected field in the data.')
    if (brnProblem(params.brn, false)) return field('brn')
    if (params.action === 'load') {
      if (typeof params.template_id !== 'string' || !UUID.test(params.template_id)) return field('template_id')
      if (params.version !== undefined && (!Number.isInteger(params.version) || params.version < 1)) return field('version')
    }
    const refusal = context(params.brn)
    if (refusal) return refusal
    const answer = (rows) => ({ ok: true, dataType: 'payslip-template', rows, meta: meta() })

    if (params.action === 'list') {
      return answer(
        [...state.templates]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((template) => {
            const latest = latestVersion(template.id)
            return {
              template_id: template.id,
              name: template.name,
              draft_revision: template.revision,
              updated_at: template.updatedAt,
              updated_by_you: template.by === 'you',
              published_version: latest?.version ?? null,
              published_at: latest?.publishedAt ?? null,
            }
          }),
      )
    }
    const template = state.templates.find((row) => row.id === params.template_id)
    if (params.version === undefined) {
      if (!template) return refuse('not-found', 'This company has no such payslip template.')
      return answer([
        {
          template_id: template.id,
          name: template.name,
          draft_revision: template.revision,
          // The database keeps a body as jsonb: the key order is its own, not the app's.
          body: sortKeys(copy(template.body)),
          updated_at: template.updatedAt,
          updated_by_you: template.by === 'you',
        },
      ])
    }
    const published = state.versions.find((row) => row.templateId === params.template_id && row.version === params.version)
    if (!published) return refuse('not-found', 'This payslip template has no such version.')
    return answer([
      {
        template_id: published.templateId,
        name: published.name,
        version: published.version,
        body: sortKeys(copy(published.body)),
        published_at: published.publishedAt,
        published_by_you: published.by === 'you',
      },
    ])
  }

  const checkTemplateSave = (row) => {
    if (!isObject(row)) return field('row')
    if (row.action !== 'save-draft' && row.action !== 'publish') return field('action')
    const publishing = row.action === 'publish'
    const allowed = publishing ? ['action', 'brn', 'template_id', 'expected_revision'] : ['action', 'brn', 'template_id', 'name', 'body', 'expected_revision']
    if (unknownKey(row, allowed)) return refuse('invalid', 'Unexpected field in the data.')
    if (brnProblem(row.brn, true)) return field('brn')
    const hasId = row.template_id !== undefined && row.template_id !== null
    if (hasId ? typeof row.template_id !== 'string' || !UUID.test(row.template_id) : publishing) return field('template_id')
    if (!Number.isInteger(row.expected_revision) || row.expected_revision < (publishing ? 1 : 0)) return field('expected_revision')
    if (!publishing) {
      if (typeof row.name !== 'string' || row.name.trim().length < 1 || row.name.trim().length > 80) return field('name')
      if (!isObject(row.body)) return field('body')
    }
    const refusal = context(row.brn)
    if (refusal) return refusal
    if (state.role !== 'admin') return refuse('forbidden', 'Only an admin of this company can save or publish a template.')

    if (publishing) {
      const found = state.templates.find((template) => template.id === row.template_id)
      if (!found) return refuse('not-found')
      if (found.revision !== row.expected_revision) return refuse('stale')
      const latest = latestVersion(found.id)
      if (latest && latest.name === found.name && same(latest.body, found.body)) return refuse('no-change')
      return {
        store: () => {
          const published = { templateId: found.id, version: (latest?.version ?? 0) + 1, name: found.name, body: copy(found.body), publishedAt: stamp(), by: 'you' }
          state.versions.push(published)
          return { template_id: found.id, version: published.version, draft_revision: found.revision, published_at: published.publishedAt }
        },
      }
    }

    if (bytes(row.body) > 150_000) return refuse('too-large', 'The template is larger than the dashboard accepts (150 KB).')
    if (hasFile(row.body)) return refuse('invalid', 'A template cannot contain images or other embedded files.')
    const name = row.name.trim()
    const taken = (exceptId) => state.templates.some((template) => template.id !== exceptId && template.name.toLowerCase() === name.toLowerCase())
    if (!hasId) {
      if (row.expected_revision !== 0) return refuse('invalid', 'Not valid: a new template starts at revision 0.')
      if (state.templates.length >= 50) return refuse('too-large', 'The company has reached the limit for this kind of data.')
      if (taken(null)) return refuse('invalid', 'This company already has one with that name.')
      return {
        store: () => {
          const created = { id: nextId(), name, body: copy(row.body), revision: 1, updatedAt: stamp(), by: 'you' }
          state.templates.push(created)
          return { template_id: created.id, name, draft_revision: 1, updated_at: created.updatedAt }
        },
      }
    }
    const found = state.templates.find((template) => template.id === row.template_id)
    if (!found) return refuse('not-found')
    if (found.revision !== row.expected_revision) return refuse('stale')
    if (taken(found.id)) return refuse('invalid', 'This company already has one with that name.')
    return {
      store: () => {
        Object.assign(found, { name, body: copy(row.body), revision: found.revision + 1, updatedAt: stamp(), by: 'you' })
        return { template_id: found.id, name, draft_revision: found.revision, updated_at: found.updatedAt }
      },
    }
  }

  // ---------- payslip-issue ----------

  const PAYSLIP_KEYS = ['national_id', 'expected_revision', 'template_id', 'template_version', 'rates', 'lines', 'accepted_differences']
  const SNAPSHOT_KEYS = ['effective_from', 'revision', 'nsf_exempt_at_60', ...RATE_KEYS, ...AMOUNT_KEYS]
  const at = (refusal, index) => ({ ...refusal, index })
  const adminContext = (brn) => context(brn) ?? (state.role !== 'admin' ? refuse('forbidden', 'Only an admin of this company can read or issue payslips.') : null)
  const latestIssued = (period, nationalId) =>
    state.issued.filter((row) => row.period === period && row.national_id === nationalId).reduce((best, row) => (!best || row.revision > best.revision ? row : best), null)

  const answerIssued = (params) => {
    if (!isObject(params) || params.action !== 'load') return field('action')
    if (unknownKey(params, ['action', 'brn', 'period'])) return refuse('invalid', 'Unexpected field in the data.')
    if (brnProblem(params.brn, true)) return field('brn')
    if (typeof params.period !== 'string' || !MONTH.test(params.period)) return field('period')
    const refusal = adminContext(params.brn)
    if (refusal) return refusal
    // The dashboard asks its user first, and the password gate must be open.
    if (state.prompt === 'deny') return refuse('denied')
    if (state.prompt === 'timeout') return refuse('timeout')
    if (!state.gateOpen) return refuse('locked', 'The dashboard is locked. Confirm your password there to unlock it, then ask again.')
    const ids = [...new Set(state.issued.filter((row) => row.period === params.period).map((row) => row.national_id))].sort()
    const rows = ids.map((id) => {
      const { by, period: _period, ...row } = latestIssued(params.period, id)
      return { ...copy(row), issued_by_you: by === 'you' }
    })
    return { ok: true, dataType: 'payslip-issue', rows, meta: { ...meta(), period: params.period } }
  }

  /** What is wrong with one payslip's shape, or null. */
  const payslipShape = (payslip) => {
    if (!isObject(payslip)) return 'payslip'
    const extra = unknownKey(payslip, PAYSLIP_KEYS)
    if (extra) return extra
    if (typeof payslip.national_id !== 'string' || payslip.national_id.trim() === '' || payslip.national_id.length > 50) return 'national_id'
    if (!Number.isInteger(payslip.expected_revision) || payslip.expected_revision < 0 || payslip.expected_revision > 50) return 'expected_revision'
    if (typeof payslip.template_id !== 'string' || !UUID.test(payslip.template_id)) return 'template_id'
    if (!Number.isInteger(payslip.template_version) || payslip.template_version < 1) return 'template_version'
    if (payslip.rates !== null) {
      const rates = payslip.rates
      if (!isObject(rates) || unknownKey(rates, SNAPSHOT_KEYS) || SNAPSHOT_KEYS.some((key) => !(key in rates))) return 'rates'
      if (typeof rates.effective_from !== 'string' || !MONTH.test(rates.effective_from) || !Number.isInteger(rates.revision) || rates.revision < 1) return 'rates'
      if (typeof rates.nsf_exempt_at_60 !== 'boolean' || [...RATE_KEYS, ...AMOUNT_KEYS].some((key) => typeof rates[key] !== 'number')) return 'rates'
    }
    if (!Array.isArray(payslip.lines) || payslip.lines.length < 1 || payslip.lines.length > 200 || !payslip.lines.every(isObject)) return 'lines'
    const differences = payslip.accepted_differences
    if (!Array.isArray(differences) || differences.length > 50) return 'accepted_differences'
    for (const difference of differences) {
      if (!isObject(difference) || unknownKey(difference, ['what', 'payroll', 'payslip', 'reason']) || typeof difference.payroll !== 'number' || typeof difference.payslip !== 'number') return 'accepted_differences'
      if (typeof difference.what !== 'string' || difference.what.trim().length < 1 || difference.what.trim().length > 80) return 'accepted_differences'
      if (typeof difference.reason !== 'string' || difference.reason.trim().length < 1 || difference.reason.trim().length > 300) return 'accepted_differences'
    }
    return null
  }

  const checkIssue = (rows) => {
    const row = rows[0]
    if (isObject(row) && Array.isArray(row.payslips) && row.payslips.length > 1000) {
      return refuse('too-large', 'At most 1000 payslips can be issued in one save. Nothing was issued.')
    }
    if (bytes(rows) > 4_000_000) return refuse('too-large', 'The data is larger than the dashboard accepts.')
    if (!isObject(row) || row.action !== 'issue') return field('action')
    if (unknownKey(row, ['action', 'brn', 'period', 'payslips'])) return refuse('invalid', 'Unexpected field in the data.')
    if (brnProblem(row.brn, true)) return field('brn')
    if (typeof row.period !== 'string' || !MONTH.test(row.period)) return field('period')
    if (!Array.isArray(row.payslips) || row.payslips.length < 1) return field('payslips')
    for (const [index, payslip] of row.payslips.entries()) {
      const wrong = payslipShape(payslip)
      if (wrong) return at(field(`payslips.${index}.${wrong}`), index)
    }
    const refusal = adminContext(row.brn)
    if (refusal) return refusal
    if (!state.gateOpen) return refuse('locked')

    const seen = new Set()
    for (const [index, payslip] of row.payslips.entries()) {
      const id = payslip.national_id.trim()
      if (bytes(payslip) > 16_000) return at(refuse('too-large', 'A payslip is larger than the dashboard accepts (16 KB). Nothing was issued.'), index)
      if (hasFile(payslip)) return at(refuse('invalid', 'A payslip cannot contain images or other embedded files. Nothing was issued.'), index)
      if (seen.has(id)) return at(refuse('invalid', 'The same employee appears twice in the month. Nothing was issued.'), index)
      seen.add(id)
    }
    for (const [index, payslip] of row.payslips.entries()) {
      const id = payslip.national_id.trim()
      if (state.employees && !state.employees.includes(id)) {
        return at(refuse('not-found', `Payslip ${index + 1} is for someone who is not a current employee of this company. Nothing was issued.`), index)
      }
      if (!state.versions.some((version) => version.templateId === payslip.template_id && version.version === payslip.template_version)) {
        return at(refuse('not-found', `Payslip ${index + 1} names a template version this company does not have. Nothing was issued.`), index)
      }
      const latest = latestIssued(row.period, id)?.revision ?? 0
      if (latest !== payslip.expected_revision) {
        return at(refuse('stale', `Payslip ${index + 1} was issued by someone else since the month was loaded. Nothing was issued.`), index)
      }
      if (latest >= 50) return at(refuse('too-large', `Payslip ${index + 1} already has 50 revisions for that month. Nothing was issued.`), index)
    }
    return {
      store: () => {
        const issuedAt = stamp()
        const stored = row.payslips.map((payslip) => {
          const { expected_revision: expected, ...rest } = copy(payslip)
          return { ...rest, national_id: payslip.national_id.trim(), revision: expected + 1, issued_at: issuedAt, period: row.period, by: 'you' }
        })
        state.issued.push(...stored)
        return { period: row.period, issued: stored.length, issued_at: issuedAt, payslips: stored.map((p) => ({ national_id: p.national_id, revision: p.revision })) }
      },
    }
  }

  /** Another admin issues the next revision for one employee, as if from another browser. */
  function otherAdminIssues(period, nationalId, change = {}) {
    const latest = latestIssued(period, nationalId)
    const base = latest ?? { national_id: nationalId, period, template_id: state.versions[0]?.templateId, template_version: 1, rates: null, lines: [{ kind: 'note', text: 'issued elsewhere' }], accepted_differences: [] }
    state.issued.push({ ...copy(base), ...change, revision: (latest?.revision ?? 0) + 1, issued_at: stamp(), by: 'other' })
  }

  // ---------- payroll-result: one saved run, asked for by month ----------
  // As the dashboard does it: its user is asked first and the password gate must be open. The
  // answer names the month and the company in `meta`, with no BRN (the rows carry it). A month
  // with no run is refused with a sentence and NO code.
  function answerPayroll(payload) {
    const next = state.nextRequest
    state.nextRequest = null
    if (next?.mode === 'lost') return undefined
    if (next?.mode === 'refuse') return refuse(next.code)
    if (!state.signedIn || !state.company) return refuse('unavailable', 'Nobody is signed in to the dashboard, or no company is selected.')
    if (state.prompt === 'deny') return refuse('denied')
    if (state.prompt === 'timeout') return refuse('timeout')
    if (!state.gateOpen) return refuse('locked', 'The dashboard is locked. Confirm your password there to unlock it, then ask again.')
    const months = Object.keys(state.runs).sort()
    const wanted = payload.period ?? months[months.length - 1]
    const rows = wanted === undefined ? undefined : state.runs[wanted]
    if (!rows) return { ok: false, error: `There is no saved run for ${payload.period ?? 'this company'}.` }
    if (rows.length === 0) return { ok: false, error: 'That run has no employees.' }
    return { ok: true, dataType: 'payroll-result', rows: copy(rows), meta: { period: wanted, label: state.company.name } }
  }

  // ---------- one message in, one answer out (or none: `undefined` is a lost answer) ----------

  function handle(type, payload) {
    state.log.push({ type, payload: copy(payload) })
    const dataType = payload?.dataType
    // The app may ask for a payroll run; it may never save one.
    if (dataType === 'payroll-result' && type === 'request-data') return answerPayroll(payload)
    if (dataType !== 'statutory-rates' && dataType !== 'payslip-template' && dataType !== 'payslip-issue') {
      return { ok: false, error: 'This app is not registered for that kind of data.' }
    }
    if (type === 'request-data') {
      const next = state.nextRequest
      state.nextRequest = null
      if (next?.mode === 'lost') return undefined
      if (next?.mode === 'refuse') return refuse(next.code)
      if (dataType === 'payslip-issue') return answerIssued(payload.params ?? {})
      return dataType === 'statutory-rates' ? answerRates(payload.params) : answerTemplates(payload.params ?? {})
    }
    if (!Array.isArray(payload.rows) || payload.rows.length !== 1) return refuse('invalid', 'Send exactly one row: one command per message.')
    const next = state.nextSave
    state.nextSave = null
    if (next?.mode === 'refuse') return refuse(next.code)
    const checked =
      dataType === 'payslip-issue' ? checkIssue(payload.rows) : dataType === 'statutory-rates' ? checkRatesSave(payload.rows[0]) : checkTemplateSave(payload.rows[0])
    if (checked.ok === false) return checked
    if (next?.mode === 'lost-unsaved') return undefined
    if (next?.mode === 'unavailable-unsaved') return refuse('unavailable')
    const result = checked.store()
    if (next?.mode === 'lost') return undefined
    if (next?.mode === 'unavailable') return refuse('unavailable')
    return { ok: true, result }
  }

  /** Another admin adds a rates revision, as if from another browser. */
  function otherAdminSavesRates(month, values) {
    const latest = latestRates(month)
    state.rates.push({ effective_from: month, revision: (latest?.revision ?? 0) + 1, source_note: null, ...values, created_at: stamp(), by: 'other' })
  }
  /** Another admin saves over a draft, as if from another browser. */
  function otherAdminSavesDraft(templateId, change) {
    const found = state.templates.find((template) => template.id === templateId)
    Object.assign(found, change, { revision: found.revision + 1, updatedAt: stamp(), by: 'other' })
  }

  return { state, handle, otherAdminSavesRates, otherAdminSavesDraft, otherAdminIssues }
}
