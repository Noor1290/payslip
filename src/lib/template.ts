// A payslip template is data, not code: labels, lines and where each line's figure comes from.
// Phase 1 has one built-in template ("Table"); Phase 3 makes templates editable and stored.

export type LineSide = 'earnings' | 'deductions'

export interface TemplateLine {
  id: string
  label: string
  side: LineSide
}

export interface DeductionGroup {
  label: string
  /** The reference leaves one empty row between this heading and its lines. */
  gapAfterLabel?: boolean
  lines: TemplateLine[]
}

export interface PayslipTemplate {
  id: string
  name: string
  version: string
  labels: {
    title: string
    brnPrefix: string
    payPeriodPrefix: string
    employeeInfo: string
    name: string
    dateOfEmployment: string
    nic: string
    earnings: string
    deductions: string
    currency: string
    totalEarnings: string
    totalDeductions: string
    netPay: string
    signatureEmployee: string
    signatureEmployer: string
    date: string
  }
  earnings: TemplateLine[]
  deductionGroups: DeductionGroup[]
}

const earning = (id: string, label: string): TemplateLine => ({ id, label, side: 'earnings' })
const deduction = (id: string, label: string): TemplateLine => ({ id, label, side: 'deductions' })

/** The reference "Table" template, with the reference's exact wording, plus the Allowances line. */
export const TABLE_TEMPLATE: PayslipTemplate = {
  id: 'table',
  name: 'Table',
  version: 'built-in-1',
  labels: {
    title: 'Payslip',
    brnPrefix: 'BRN : ',
    payPeriodPrefix: 'Pay period: ',
    employeeInfo: 'Employee Info',
    name: 'Name :',
    dateOfEmployment: 'Date of Employment :',
    nic: 'NIC :',
    earnings: 'Earnings',
    deductions: 'Deductions',
    currency: 'Rs',
    totalEarnings: 'Total Earnings',
    totalDeductions: 'Total Deductions',
    netPay: 'Net Pay :',
    signatureEmployee: 'Signature Employee :',
    signatureEmployer: 'Signature Employer :',
    date: 'Date :',
  },
  earnings: [
    earning('basic', 'Basic Salary'),
    earning('increment', 'Govt Increment'),
    earning('allowances', 'Allowances'),
    earning('transport', 'Transport Allowance'),
    earning('presenceBonus', 'Presence Bonus'),
    earning('productivityBonus', 'Productivity Bonus'),
    earning('advance', 'Advance'),
  ],
  deductionGroups: [
    {
      label: 'Contributions',
      gapAfterLabel: true,
      lines: [deduction('csg', 'CSG'), deduction('nsf', 'NSF'), deduction('paye', 'PAYE')],
    },
    {
      label: 'Others Deductions :',
      lines: [deduction('absences', 'Absences :'), deduction('lateness', 'Lateness')],
    },
  ],
}

export function templateLines(template: PayslipTemplate): TemplateLine[] {
  return [...template.earnings, ...template.deductionGroups.flatMap((group) => group.lines)]
}

export interface LineMapping {
  /** The payroll key that fills the line, or null while the line is unmapped (it shows "-"). */
  key: string | null
  /** Old column names still accepted, each with an "old name" warning. */
  aliases?: string[]
  /** The owner has not confirmed this mapping yet. */
  toConfirm?: boolean
  /** A missing figure can never be treated as zero (employee CSG and NSF). */
  required?: boolean
}

export interface TemplateMapping {
  lines: Record<string, LineMapping>
  /** The payroll totals the three payslip totals are checked against. */
  checks: { gross: string; deductions: string; net: string }
  /** Where the warning-only cross-check finds its bases. A mapping, not a rate. */
  crossCheck: { csgBase: string; nsfBase: string; nsfBaseToConfirm: boolean; aged60: string }
  /** Optional key holding the date of employment (YYYY-MM-DD). The line is blank without it. */
  dateOfEmployment: string
  /** Keys that must never fill a payslip line: employer-side columns and "PAYE (calculated)". */
  neverMap: string[]
}

export const DEFAULT_TABLE_MAPPING: TemplateMapping = {
  lines: {
    basic: { key: 'Basic Salary' },
    increment: { key: 'Govt Increment' },
    allowances: { key: 'Allowances' },
    transport: { key: 'Travelling', toConfirm: true },
    presenceBonus: { key: null },
    productivityBonus: { key: null },
    advance: { key: null },
    csg: { key: 'Employee CSG', aliases: ['CSG - 1.5 %/ 3%'], required: true },
    nsf: { key: 'Employee NSF', aliases: ['NSF - 1%'], required: true },
    paye: { key: 'PAYE' },
    absences: { key: null },
    lateness: { key: null },
  },
  checks: { gross: 'Gross Pay', deductions: 'Total deductions', net: 'Net Pay' },
  crossCheck: { csgBase: 'New Basic Salary', nsfBase: 'Gross Pay', nsfBaseToConfirm: true, aged60: 'Age 60+' },
  dateOfEmployment: 'Date of Employment',
  neverMap: [
    'CSG',
    'NSF',
    'Levy',
    'PRGF',
    'Total MRA contributions',
    'EDF',
    'EDF (monthly)',
    'Total',
    'PAYE (calculated)',
  ],
}

/** Keys a line may be mapped to: numbers found in the data, minus the never-map list. */
export function mappableKeys(
  keys: readonly string[],
  rows: readonly Record<string, unknown>[],
  mapping: TemplateMapping,
): string[] {
  const blocked = new Set(mapping.neverMap)
  return keys.filter((key) => !blocked.has(key) && rows.some((row) => typeof row[key] === 'number'))
}
