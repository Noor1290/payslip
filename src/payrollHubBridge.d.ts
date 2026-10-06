// Types for src/payrollHubBridge.js (an unchanged copy from the payroll-hub repo; see the note
// at the top of docs/INTEGRATION.md). The bridge defines window.PayrollHubBridge.
interface PayrollHubPayload {
  dataType: string
  rows: Record<string, unknown>[]
  meta?: { period?: string; label?: string }
}
type PayrollHubReply = ({ ok: true } & Partial<PayrollHubPayload>) | { ok: false; error: string; code?: string }
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
