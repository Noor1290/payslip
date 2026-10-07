import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { mergePayroll, readHubPayload, readHubReply } from '../src/lib/hubBridge'
import type { ImportedPayroll } from '../src/lib/payrollFile'
import { FIXTURE_NAME, loadFixture, readFixtureText, root } from './helpers'

const HUB_ORIGIN = 'https://noor1290.github.io'
const bridgeFile = resolve(root, 'src/payrollHubBridge.js')
const fixtureRows = () => JSON.parse(readFixtureText(FIXTURE_NAME)) as Record<string, unknown>[]

interface Posted {
  message: { type: string; from: string; to: string; version: number; id: string; payload: Record<string, unknown> }
  targetOrigin: string
}

/**
 * Runs the REAL, unchanged bridge file against a fake window, as if the app were inside the
 * dashboard's iframe. `deliver` plays the dashboard sending a message.
 */
function embeddedBridge() {
  const posted: Posted[] = []
  const storageWrites: string[] = []
  const listeners: ((event: unknown) => void)[] = []
  const parent = { postMessage: (message: Posted['message'], targetOrigin: string) => posted.push({ message, targetOrigin }) }
  const storage = (name: string) => ({
    setItem: (key: string) => storageWrites.push(`${name}.${key}`),
    getItem: () => null,
    length: 0,
  })
  const window: Record<string, unknown> = {
    parent,
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (type === 'message') listeners.push(listener)
    },
    crypto: { randomUUID },
    localStorage: storage('localStorage'),
    sessionStorage: storage('sessionStorage'),
  }
  vm.runInNewContext(readFileSync(bridgeFile, 'utf8'), { window, setTimeout, clearTimeout })
  const bridge = window.PayrollHubBridge as Window['PayrollHubBridge']
  const deliver = (
    message: Record<string, unknown>,
    from: { origin?: string; source?: unknown } = {},
  ) => {
    const event = { data: message, origin: from.origin ?? HUB_ORIGIN, source: from.source ?? parent }
    for (const listener of listeners) listener(event)
  }
  const sendData = (id: string, payload: unknown, from?: { origin?: string; source?: unknown }) =>
    deliver({ type: 'send-data', from: 'dashboard', to: 'payslip', version: 1, id, payload }, from)
  const replies = (id: string) => posted.filter((p) => p.message.id === id && p.message.type === 'received')
  return { bridge, posted, storageWrites, deliver, sendData, replies }
}

/** The app's own handler, as App.tsx wires it: validate, then keep the data waiting. */
function appReceiver() {
  const waiting: ImportedPayroll[] = []
  return { waiting, onData: (payload: unknown) => void waiting.push(readHubPayload(payload)) }
}

const validPayload = () => ({ dataType: 'payroll-result', rows: fixtureRows(), meta: { period: '2026-09' } })

describe('the copied bridge file', () => {
  it('is byte for byte the hub version it was copied from', () => {
    const hash = createHash('sha256').update(readFileSync(bridgeFile)).digest('hex')
    expect(hash).toBe('6e80690fe39545eaf9d8bcdaea59a5cd0c8a3688af98feb8f264af0433760564')
  })

  it('does nothing when the app is opened on its own', () => {
    const posted: unknown[] = []
    const window: Record<string, unknown> = { addEventListener: () => posted.push('listener') }
    window.parent = window
    vm.runInNewContext(readFileSync(bridgeFile, 'utf8'), { window, setTimeout, clearTimeout })
    const bridge = window.PayrollHubBridge as Window['PayrollHubBridge']
    expect(bridge.isEmbedded()).toBe(false)
    expect(bridge.init({ appId: 'payslip', onData: () => undefined })).toBe(false)
    expect(posted).toEqual([])
  })
})

describe('payroll results arriving from the dashboard', () => {
  it('valid rows reach the import and are acknowledged', () => {
    const { bridge, sendData, replies } = embeddedBridge()
    const app = appReceiver()
    bridge.init({ appId: 'payslip', onData: app.onData })
    sendData('message-0001', validPayload())

    expect(app.waiting).toHaveLength(1)
    expect(app.waiting[0].rows).toHaveLength(7)
    expect(app.waiting[0].period).toBe('2026-09')
    expect(app.waiting[0].company.name).toBe('ABC Co Ltd')
    expect(replies('message-0001').map((r) => r.message.payload)).toEqual([{ ok: true }])
  })

  it('goes through the same checks as a file: invalid rows are refused with a message', () => {
    const { bridge, sendData, replies } = embeddedBridge()
    const app = appReceiver()
    bridge.init({ appId: 'payslip', onData: app.onData })
    const rows = fixtureRows().map((row) => {
      const { 'Company Name': _name, ...rest } = row
      return rest
    })
    sendData('message-0002', { dataType: 'payroll-result', rows })

    expect(app.waiting).toEqual([])
    const [reply] = replies('message-0002')
    expect(reply.message.payload.ok).toBe(false)
    expect(String(reply.message.payload.error)).toContain('"Company Name" is missing')
  })

  it('refuses another kind of data, and rows in the wrong shape', () => {
    const { bridge, sendData, replies } = embeddedBridge()
    const app = appReceiver()
    bridge.init({ appId: 'payslip', onData: app.onData })
    sendData('message-0003', { dataType: 'something-else', rows: fixtureRows() })
    sendData('message-0004', { dataType: 'payroll-result', rows: ['not a row'] })
    sendData('message-0005', { dataType: 'payroll-result', rows: fixtureRows(), meta: { period: 'September' } })

    expect(app.waiting).toEqual([])
    expect(replies('message-0003')[0].message.payload).toEqual({ ok: false, error: 'This app can only use payroll results.' })
    expect(replies('message-0004')[0].message.payload).toEqual({ ok: false, error: 'The data was not in the expected format.' })
    expect(replies('message-0005')[0].message.payload).toEqual({ ok: false, error: 'The data was not in the expected format.' })
  })

  it('a repeated message id is not imported twice; the first answer is repeated', () => {
    const { bridge, sendData, replies } = embeddedBridge()
    const app = appReceiver()
    bridge.init({ appId: 'payslip', onData: app.onData })
    sendData('message-0006', validPayload())
    sendData('message-0006', validPayload())

    expect(app.waiting).toHaveLength(1)
    expect(replies('message-0006').map((r) => r.message.payload)).toEqual([{ ok: true }, { ok: true }])
  })

  it('ignores a message from another origin or another window', () => {
    const { bridge, sendData, posted } = embeddedBridge()
    const app = appReceiver()
    bridge.init({ appId: 'payslip', onData: app.onData })
    const before = posted.length
    sendData('message-0007', validPayload(), { origin: 'https://example.com' })
    sendData('message-0008', validPayload(), { source: { postMessage: () => undefined } })

    expect(app.waiting).toEqual([])
    expect(posted).toHaveLength(before)
  })

  it('only ever posts to the exact dashboard origin, never "*", and writes nothing to browser storage', async () => {
    const { bridge, sendData, posted, storageWrites, deliver } = embeddedBridge()
    const app = appReceiver()
    bridge.init({ appId: 'payslip', onData: app.onData })
    sendData('message-0009', validPayload())
    const request = bridge.requestData('payroll-result')
    const asked = posted.find((p) => p.message.type === 'request-data')!
    deliver({ type: 'response-data', from: 'dashboard', to: 'payslip', version: 1, id: asked.message.id, payload: { ok: true, ...validPayload() } })
    await request

    expect(posted.length).toBeGreaterThanOrEqual(3)
    expect(new Set(posted.map((p) => p.targetOrigin))).toEqual(new Set([HUB_ORIGIN]))
    expect(new Set(posted.map((p) => p.message.from))).toEqual(new Set(['payslip']))
    expect(storageWrites).toEqual([])
  })
})

describe('"Get from dashboard"', () => {
  it('asks for payroll results and reads the answer through the same import', async () => {
    const { bridge, posted, deliver } = embeddedBridge()
    bridge.init({ appId: 'payslip' })
    const request = bridge.requestData('payroll-result')
    const asked = posted.find((p) => p.message.type === 'request-data')!
    expect(asked.message.payload).toEqual({ dataType: 'payroll-result' })
    deliver({ type: 'response-data', from: 'dashboard', to: 'payslip', version: 1, id: asked.message.id, payload: { ok: true, ...validPayload() } })

    const result = readHubReply(await request)
    expect(result.ok && result.data.rows).toHaveLength(7)
  })

  it('reports a refusal in plain words, with what to do when the dashboard is locked', () => {
    expect(readHubReply({ ok: false, error: 'The dashboard is locked.', code: 'locked' })).toEqual({
      ok: false,
      error: 'Nothing received: The dashboard is locked. Unlock the dashboard, then try again.',
    })
    expect(readHubReply({ ok: false, error: 'The request was declined.' })).toEqual({
      ok: false,
      error: 'Nothing received: The request was declined.',
    })
    expect(readHubReply({ ok: true, dataType: 'payroll-result', rows: [] })).toEqual({
      ok: false,
      error: 'Nothing received: The data was not in the expected format.',
    })
    expect(readHubReply('nonsense')).toEqual({ ok: false, error: 'Nothing received: The dashboard gave an answer this app does not understand.' })
  })
})

describe('the company the dashboard names for payroll results', () => {
  const payload = (brn?: string) => ({ dataType: 'payroll-result', rows: fixtureRows(), meta: { period: '2026-09', ...(brn ? { brn } : {}) } })

  it('accepts data whose meta.brn is the BRN in its rows, or that names none', () => {
    expect(readHubPayload(payload()).company.brn).toBe('C1234567')
    expect(readHubPayload(payload(' c1234567 ')).rows).toHaveLength(7)
  })

  it('refuses data whose meta.brn is another company than its rows', () => {
    expect(() => readHubPayload(payload('C7654321'))).toThrow('for another company than the one in its rows')
  })
})

describe('adding new data to the data already open', () => {
  const existing = loadFixture()
  const incoming = (change: (rows: Record<string, unknown>[]) => Record<string, unknown>[], period = '2026-09') =>
    readHubPayload({ dataType: 'payroll-result', rows: change(fixtureRows()), meta: { period } })
  const newPeople = (rows: Record<string, unknown>[]) =>
    rows.slice(0, 2).map((row, index) => ({ ...row, ID: `X000000000010${index}`, Surname: `NOUVEAU${index}` }))

  it('adds employees of the same company and month', () => {
    const result = mergePayroll(existing, '2026-09', incoming(newPeople))
    expect(result.ok && result.data.rows).toHaveLength(9)
    expect(result.ok && result.data.rows.slice(0, 7)).toEqual(existing.rows)
    expect(result.ok && result.data.period).toBe('2026-09')
  })

  it('refuses another month, another company, or an employee who is already there', () => {
    const otherMonth = mergePayroll(existing, '2026-09', incoming(newPeople, '2026-10'))
    expect(otherMonth).toMatchObject({ ok: false, reason: expect.stringContaining('October 2026') })

    const otherCompany = mergePayroll(existing, '2026-09', incoming((rows) => newPeople(rows).map((row) => ({ ...row, BRN: 'C7654321' }))))
    expect(otherCompany).toMatchObject({ ok: false, reason: expect.stringContaining('another company') })

    const overlap = mergePayroll(existing, '2026-09', incoming((rows) => [...rows.slice(0, 3), ...newPeople(rows)]))
    expect(overlap).toMatchObject({ ok: false, reason: expect.stringContaining('3 of these employees are already') })
    const allThere = mergePayroll(existing, '2026-09', incoming((rows) => rows.slice(0, 3)))
    expect(allThere).toMatchObject({ ok: false, reason: 'All of these employees are already in the list.' })
    // The ID itself is never printed.
    expect(JSON.stringify(overlap)).not.toContain('X0000000000001')
  })
})
