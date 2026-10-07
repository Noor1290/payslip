// Types for src/payrollHubBridge.js, an unchanged copy of docs/bridge.js from the payroll-hub
// repo (bridge protocol version 1). The declaration is the one given in docs/INTEGRATION.md.
// The bridge defines window.PayrollHubBridge.
interface PayrollHubPayload {
  dataType: string
  rows: Record<string, unknown>[]
  meta?: { period?: string; label?: string; brn?: string }
}
type PayrollHubReply =
  | ({ ok: true; result?: Record<string, unknown> } & Partial<PayrollHubPayload>)
  | { ok: false; error: string; code?: string }
interface Window {
  PayrollHubBridge: {
    isEmbedded(): boolean
    isConnected(): boolean
    init(options: { appId: string; onData?: (payload: PayrollHubPayload) => unknown }): boolean
    sendToDashboard(type: 'send-data' | 'request-data', payload: unknown): Promise<PayrollHubReply>
    requestData(dataType: string, period?: string): Promise<PayrollHubReply>
    onStatus(listener: (connected: boolean) => void): () => void
  }
}
