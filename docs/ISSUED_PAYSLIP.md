# An issued payslip: what is stored

When a month is issued, the app sends one message to the Payroll Hub dashboard (`payslip-issue`, see `docs/INTEGRATION.md`). For each employee the dashboard keeps a snapshot that is never changed. The dashboard fixes most of the snapshot's keys; the one this app defines is **`lines`**. This file says what `lines` holds. The code is `src/lib/issuedLines.ts`; the tests are `tests/issuedLines.test.ts`. All examples use fake data (ABC Co Ltd).

## The rule

`lines` holds everything needed to show the payslip again **exactly as issued**. A reopened payslip is drawn from `lines` alone. It is never recalculated from payroll data, from a template or from rates, so a later change to any of those cannot change a payslip that was issued.

## Format number

`lines[0].format` is `1`. It goes up whenever the shape changes. A payslip whose format this app does not know is not shown: the app says so, and never guesses.

## Drawing version

`lines[0].drawing` is `1`. It names the rules the payslip is drawn with: the page geometry, sizes and line weights of the preview and the PDF, the styles of the Excel sheet, and the bundled font files. A change to any of them is a new drawing version, and the app keeps the old rules for the payslips issued with them, so a payslip of format 1, drawing 1 always looks the same (`tests/format1.test.ts`). A payslip whose drawing version this app does not have is not shown. A payslip issued before this key existed has none: it is read as `1`, the only version there was.

## Shape (format 1)

`lines` is a list of JSON objects (the dashboard allows 1 to 200; a payslip uses 33 to 44), in this order:

1. **One `document` object**: the page.

   ```json
   {
     "kind": "document",
     "format": 1,
     "template": { "id": "20000000-0000-4000-8000-000000000001", "version": "v2" },
     "drawing": 1,
     "page": { "size": "A4", "orientation": "portrait" },
     "fonts": { "excel": "Book Antiqua", "print": "TeX Gyre Pagella" },
     "columnWidths": [28.77734375, 32.77734375, 35.6640625, 40.5546875],
     "firstExcelRow": 4,
     "dividerFromRowId": "headings",
     "employeeName": "DOE JANE",
     "period": "2026-09"
   }
   ```

2. **One `figures` object**: each line of the payslip as a figure, and the three totals. Amounts are whole cents (integers), so nothing can be rounded on the way.

   ```json
   {
     "kind": "figures",
     "lines": [
       { "id": "basic", "label": "Basic Salary", "side": "earnings", "cents": 1800000, "source": "Basic Salary" },
       { "id": "advance", "label": "Advance", "side": "earnings", "cents": 0, "source": null, "status": "unmapped" }
     ],
     "totals": { "earnings": 2108500, "deductions": 49037, "net": 2059463 }
   }
   ```

   - `id` is the line's id in its template. The same line in another month has the same id.
   - `source` is the payroll column the figure was copied from, or `null` for a line that is not mapped.
   - `status` is left out when it is `"ok"`. Otherwise `"unmapped"` (the line shows "-") or `"treated-as-zero"` (the figure was missing and accepted as zero); the second always has a `reason`, the sentence typed when it was accepted.
   - The totals are the plain addition of the lines, as on the page.

3. **One object per row of the page**, top to bottom. A row has no `kind`.

   ```json
   { "id": "title", "fill": "66CCFF", "rule": "black", "cells": [{ "col": 0, "text": "Payslip", "span": 4, "bold": true, "size": 12, "align": "center" }] }
   { "id": "body-1", "cells": [
       { "col": 0, "text": "Basic Salary" },
       { "col": 1, "text": "18,000", "kind": "money", "cents": 1800000, "lineId": "basic" } ] }
   { "id": "gap-1" }
   ```

   - Row: `id`; `fill` (a band colour, RRGGBB) and `rule` (`"black"` or `"grey"`, a line under the row) only when there is one; `cells` only when the row has any.
   - Cell: `col` (0 to 3, the Excel columns B to E) and `text` (exactly what is printed) always. The rest only when it is not the default:

     | Key | Default when left out |
     |---|---|
     | `kind` | `"text"` (otherwise `"money"` or `"date"`) |
     | `span` | `1` (otherwise 2 or 4 columns) |
     | `bold` | not bold |
     | `size` | `11` (otherwise 12) |
     | `align` | `"right"` for money, `"left"` for anything else |
     | `cents` | none (a money cell has it) |
     | `isoDate` | none (a date cell has it, `YYYY-MM-DD`) |
     | `lineId` | none (names a figure, so a total can point at its lines) |
     | `formula` | none (a total has it: `{ "op": "sum" or "subtract", "lineIds": [...] }`, used for the live Excel formula) |

The company name, address and BRN, the employee's name and NIC, the pay period, the date of employment and the date on the payslip are all in the rows, as the text that was printed. They are personal data: `lines` exists only in the bridge message, in the dashboard's database and in this tab's memory.

## What is NOT in `lines`

These are separate keys of the stored payslip, fixed by the dashboard:

| Key | What |
|---|---|
| `national_id` | The employee (the `ID` of the payroll rows) |
| `revision` | 1, 2, 3... per employee and month. Set by the database |
| `template_id`, `template_version` | The published template version the payslip was made with. Loaded on reopen only to show its name |
| `rates` | The statutory rates the cross-check used, copied (eight keys), or `null` when the figures were not cross-checked |
| `accepted_differences` | Each difference from the payroll totals that was accepted: `{ what, payroll, payslip, reason }`, amounts as numbers with 2 decimals |
| `issued_at`, `issued_by_you` | Set by the database |

## Checks when reading

Stored lines are data from outside: they are checked before use (Zod, no unknown keys, the format number). A payslip that fails is listed as "cannot be shown", with the reason, and the others are shown.

The dashboard keeps JSON in a database type that does not keep the order of an object's keys. Order only matters in lists here (the rows, the cells, the figures), and lists keep theirs.

## Size

The dashboard refuses a payslip over 16,000 bytes (the whole payslip, with its other keys) and a message over 4,000,000 bytes. Measured on the fake fixtures:

| Payslip | `lines` as JSON |
|---|---|
| Built-in Table template (9 rows of lines), seven employees | 5,539 to 5,618 bytes |
| The largest template the editor allows (20 rows on each side) | 10,692 bytes |

A whole payslip as sent (the lines plus the national ID, the template, the rates and the accepted differences) is 5,918 to 6,078 bytes for the seven fake employees. About 657 of them fit in one 4 MB message.

Before sending, the app measures each payslip and refuses one that is too large, naming the employee. It never trims. A month too large for one message is sent in batches (`docs/KNOWN_ISSUES.md`, issues 21 and 22).

## For the month review (Phase 5)

The `figures` object is what the review compares. It loads LAST month only (this month is always built from this month's payroll figures and never read from a stored payslip), and compares each employee's lines by `id` when both months used the same template, or by `label` (same side of the page, capitals and extra spaces ignored) when they did not. A line without exactly one partner is listed as not matched. The employee is matched by `national_id`, the name comes from `employeeName`, the date of employment from the date cell of the `employee-name` row, and the template and rates versions from the stored payslip's own `template_id`, `template_version` and `rates`. A stored payslip that fails the checks above is "cannot be compared", never guessed at. The code is `src/lib/monthCompare.ts`; nothing is added to `lines`, and the format stays 1.
