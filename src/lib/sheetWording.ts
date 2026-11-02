// The words for what goes in a cell of a "From your file" layout.

import type { CompanyField, DateOf, Source } from './sheetBody'

export type SourceChoice = 'text' | 'fixed' | 'company' | 'employee' | 'payroll' | 'calc' | 'employment' | 'month' | 'today' | 'field' | 'empty'

export const SOURCE_LABELS: Record<SourceChoice, string> = {
  text: 'Text as typed',
  fixed: 'Fixed value',
  company: 'Company detail',
  employee: 'Employee field',
  payroll: 'Payroll figure',
  calc: 'A small calculation',
  employment: 'Date of employment',
  month: 'Pay month',
  today: "Today's date",
  field: 'Another date field',
  empty: 'Empty',
}

export const COMPANY_LABELS: Record<CompanyField, string> = { name: 'Company name', address: 'Address', brn: 'BRN', vat: 'VAT' }

const DATE_CHOICE: Record<DateOf, SourceChoice> = { employment: 'employment', month: 'month', today: 'today', field: 'field' }

export function choiceOf(source: Source): SourceChoice {
  if (source.type === 'date') return DATE_CHOICE[source.of]
  if (source.type === 'name') return 'employee'
  return source.type
}

/** A few words for a cell of the grid. */
export function sourceSummary(source: Source): string {
  switch (source.type) {
    case 'empty':
      return 'Empty'
    case 'text':
      return 'Text as typed'
    case 'fixed':
      return 'Fixed value'
    case 'company':
      return COMPANY_LABELS[source.field]
    case 'name':
      return 'Full name'
    case 'employee':
      return source.key
    case 'payroll':
      return source.key
    case 'calc':
      return 'Calculation'
    case 'date':
      return source.of === 'field' ? (source.key ?? SOURCE_LABELS.field) : SOURCE_LABELS[DATE_CHOICE[source.of]]
  }
}
