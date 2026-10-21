# An issued payslip: what is stored

When a month is issued, the app sends one message to the Payroll Hub dashboard (`payslip-issue`, see `docs/INTEGRATION.md`). For each employee the dashboard keeps a snapshot that is never changed. The dashboard fixes most of the snapshot's keys; the one this app defines is **`lines`**. This file says what `lines` holds. The code is `src/lib/issuedLines.ts`; the tests are `tests/issuedLines.test.ts`. All examples use fake data (ABC Co Ltd).

## The rule

`lines` holds everything needed to show the payslip again **exactly as issued**. A reopened payslip is drawn from `lines` alone. It is never recalculated from payroll data, from a template or from rates, so a later change to any of those cannot change a payslip that was issued.

## Format number

`lines[0].format` is `1`. It goes up whenever the shape changes. A payslip whose format this app does not know is not shown: the app says so, and never guesses.

## Drawing version

`lines[0].drawing` names the rules the payslip is drawn with: the page geometry, sizes and line weights of the preview and the PDF, the styles of the Excel sheet, and the bundled font files. A change to any of them is a new drawing version, and the app keeps the old rules for the payslips issued with them, so a payslip of format 1, drawing 1 always looks the same (`tests/format1.test.ts`). A payslip whose drawing version this app does not have is not shown. A payslip issued before this key existed has none: it is read as `1`, the only version there was.

| Drawing | Since | What it adds |
|---|---|---|
| 1 | Phase 4 | The reference layout. A name too wide for its column is set smaller, down to 6 points; below that the payslip is refused. |
| 2 | 21 October 2026 | A name that does not fit on one line, even at 6 points, goes on two (known issue 1); Excel sets a name smaller when the page does (known issue 40). |
| 3 | 21 October 2026 | The company address is split at its last comma. |
| 4 | 21 October 2026 | A name that does not fit its column at 8 points or more gets a wider place on its row. Payslips are made with it now. |

**Drawing 4.** A name that fits its column (about 115 points) at the normal size (10 points on the page), or smaller down to 8, is drawn exactly as in drawing 3. Otherwise the name has a wider place on the same row: it starts 8 points after "Name :", and "Date of Employment :" with its date moves right until the date ends where the row ends, 8 points apart; the name ends 8 points before the moved label (about 310 points with a date, more without one). Nothing else on the page moves. In that place the name is on one line, at the normal size or smaller down to 8 points; otherwise on two lines there, broken at a space after the surname as in drawing 2 (the break stored in the name cell's text, the row twice as tall, every row below one row lower, "Date of Employment :" on the first line), down to 8 points; otherwise the payslip is refused with the usual "too long" error. Where the name and the date are drawn is not stored: it follows from the stored text by these rules, so the format stays 1. In Excel, a name in the wide place is in the merged cells C:D, and column E holds "Date of Employment :" and the date, right-aligned: the date is still a date, its label written by its number format (`"Date of Employment : "d-mmm-yy`), or the label alone when there is no date. The column widths do not change. Each is set at the largest whole size, 11 at most and never larger than the page's size, that fits there by the page's measure (11 in Excel is 10 on the page); C:D is narrower than the page's wide place, so the longest names are smaller in Excel than on the page, and E is 10 points with the usual label. Two stored payslips whose name is the same text, broken over two lines anywhere or not at all, are the same payslip (`sameLines`), and drawings 1 to 4 count as the same. The frozen drawing-4 payslip is `tests/frozen/format-1-drawing-4/` (`tests/wideName.test.ts`).

**Drawing 3.** The address lines (rows `address-1` and `address-2`) hold the address split at its LAST comma: line 3 everything before it, commas kept, line 4 what comes after it (`"Impasse Fictive 2, Avenue Exemple Remy Sample, Bonne Terre"` / `"Vacoas"`, fake). The address is cut at every comma and line break, each part trimmed, runs of spaces made one, and empty parts left out (a trailing comma). One comma gives what drawings 1 and 2 gave; no comma puts the whole address on line 3 and leaves line 4 empty, as before. When line 3 is too wide at the normal size (11 points), its last parts move down to the start of line 4, at a comma, or, when no comma break fits, its last words. Only when no split fits at the normal size are both lines set smaller, together, never below 8 points (a split at a comma first). An address that does not fit even at 8 points is refused with the usual "too long" error. In Excel, smaller address lines are set smaller too, in whole points. The split is in the stored text, so the format stays 1. Everything else is drawn as in drawing 2. Two stored payslips whose address is the same text, however it is split over the two lines, are the same payslip (`sameLines`, known issue 41). The frozen drawing-3 payslip is `tests/frozen/format-1-drawing-3/` (`tests/addressSplit.test.ts`).

**Drawing 2.** The break is chosen when the payslip is made and stored in the name cell's `text` as one line break (`"BHAGWANSINGH Marie\nAnne Josee Claudette"`, fake), so a reopened payslip breaks in the same place. `employeeName` keeps the name on one line. The break is at a space after the surname, so the surname stays whole on the first line. The size is the normal one when the two lines fit, otherwise the largest that fits, down to 6 points; if two lines do not fit either, the payslip is refused as before. The name row is then twice as tall and every row below it is one row lower. In Excel the name cell wraps at the line break, the row is 36 points high (two lines of Book Antiqua 11 as Excel spaces them), and the other cells of that row sit at its top. Whenever the page sets the name smaller, on one line or two, Excel sets it smaller too, rounded down to a whole point so it is never cut off (9.7 on the page is 10 in Excel, 6.0 is 6; known issue 40). Apart from that Excel size, a payslip whose name fits on one line is drawn by drawing 2 exactly as by drawing 1 (`tests/longNames.test.ts`), so the format stays 1 and two stored payslips that differ only by drawing 1 or 2 are the same payslip (`sameLines`). The frozen drawing-2 payslip is `tests/frozen/format-1-drawing-2/`.

## Shape (format 1)

`lines` is a list of JSON objects (the dashboard allows 1 to 200; a payslip uses 33 to 44), in this order:

1. **One `document` object**: the page.

   ```json
   {
     "kind": "document",
     "format": 1,
     "template": { "id": "20000000-0000-4000-8000-000000000001", "version": "v2" },
     "drawing": 2,
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
