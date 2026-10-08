# Payslip app: full brief

A separate app in the Payroll Hub family. It takes one month of payroll results, lays them out on a payslip for each employee, and exports PDF and Excel. Today's scope is ONE template, the "Table" template, shown in `docs/reference/` (an .xlsx and its PDF). A second, lookup-style template is "coming soon" and only appears as a disabled card. This payslip is for the EMPLOYEE side only; employer contributions never appear on it.

Companion files: `CLAUDE.md` (short rules), `docs/DESIGN_SYSTEM.md` (look and feel), `docs/reference/` (the template), and the Payroll Hub's `INTEGRATION.md` and `bridge.js` (copy them into `_hub-docs/` when you reach the bridge phase).

## 1. Context

- Payroll Hub: a dashboard at https://noor1290.github.io/payroll-hub/ that embeds the apps in iframes and moves data between them with postMessage. Apps never talk to each other or to Supabase. Data goes app -> hub -> app.
- Sister apps: `payroll_sys` (calculates payroll and exports a JSON, id `payroll`) and `pdf-form-filler` (fills PDF forms, id `pdf-editor`). This app's registry id is `payslip`; its entry already exists in the hub as "coming soon" and needs a URL when this app is deployed.
- All apps share one origin (https://noor1290.github.io). The bridge checks prevent mix-ups, not a hostile app on the same origin.
- Data arrives as `{ dataType: "payroll-result", rows: [...], meta: { period: "YYYY-MM" } }`. One row per employee, with the company fields repeated on every row. The keys of a row are: ID, Surname, Other names, Basic Salary, Govt Increment, New Basic Salary, Full time / Part time, Allowances, Emoluments, Travelling, Gross Pay, Age 60+, CSG, NSF, PAYE, Total deductions, Net Pay, Levy, PRGF, Total MRA contributions, EDF, EDF (monthly), Total, Company Name, Address, BRN, VAT. Companies can also define their own columns in the payroll app; those arrive as additional keys, and the hub stores them in `payroll_entries.extra`.
- Opened on its own, the app imports the same JSON as a file (the file the payroll app calls "Export for PDF fill (JSON)").

## 2. The Table template (what the reference shows)

One portrait page, four columns, thick outer border and a thick vertical divider between the Earnings half and the Deductions half. Font Book Antiqua 11 (headings 12). Header bands are filled #66CCFF. Amounts have a thousands separator; the reference shows whole rupees, but the app shows no decimals for a whole amount and 2 decimals otherwise (see 3a). A zero shows as "-".

| Block | Content |
|---|---|
| Title band | "Payslip" (bold, centred, blue band) |
| Company | company name (bold), address line 1, address line 2, "BRN : <brn>" (all centred) |
| Pay period | "Pay period: September 2026" (bold, right-aligned) |
| Employee band | "Employee Info" (blue band) |
| Employee rows | "Name :" <surname + other names> and "Date of Employment :" <d-mmm-yy>; "NIC :" <id> |
| Headings | "Earnings" over the left half, "Deductions" over the right half, "Rs" above each amount column |
| Earnings lines | Basic Salary, Govt Increment, Transport Allowance, Presence Bonus, Productivity Bonus, Advance |
| Deductions lines | group "Contributions": CSG, NSF, PAYE. Group "Others Deductions :": Absences, Lateness |
| Totals | "Total Earnings" (left), "Total Deductions" (right) |
| Net pay | "Net Pay :" (right half) |
| Sign-off | "Signature Employee :", "Signature Employer :", and "Date :" with a d-mmm-yy date |

In the reference workbook the totals and the CSG and NSF lines are Excel formulas: Total Earnings is the sum of the earnings lines, Total Deductions is CSG + NSF + PAYE + Absences + Lateness, Net Pay is Total Earnings minus Total Deductions, and CSG and NSF are 1.5% and 1% of (Basic Salary - Absences - Lateness + Govt Increment). Those two rates are the employee's share.

## 3. Where each line comes from (check this before designing anything)

I compared the reference with a sample payroll JSON. Status: OK = available as is; CONFIRM = probably available, needs my confirmation; MISSING = not in the data; TRAP = a field with the same name that does NOT mean the same thing.

| Template line | Source | Status |
|---|---|---|
| Company name, BRN | `Company Name`, `BRN` | OK |
| Address (two lines) | `Address` (one string) | OK, needs a split rule (a comma or a line break) |
| Pay period | `meta.period` ("2026-09") | OK |
| Name | `Surname` + `Other names` | OK |
| NIC | `ID` | OK (sensitive) |
| Date of Employment | not in the data | MISSING |
| Basic Salary, Govt Increment | `Basic Salary`, `Govt Increment` | OK |
| Transport Allowance | `Travelling`, or a company column | CONFIRM |
| Presence Bonus, Productivity Bonus, Advance, Absences, Lateness | no standard key; would arrive as company columns in `extra` if ticked in the payroll app's export | CONFIRM |
| CSG, NSF | `CSG`, `NSF` | TRAP |
| PAYE | `PAYE` | CONFIRM it is the employee's PAYE |
| Total Earnings | sum of the earnings lines, or `Gross Pay` | CONFIRM, reconcile |
| Total Deductions | `Total deductions` | OK |
| Net Pay | `Net Pay` | OK |
| Date (sign-off) | chosen when issuing | OK |

**The CSG and NSF trap.** In the sample data, the `CSG` column is 3% to 6% of New Basic Salary and `NSF` is 1.3% to 2.4%: those look like the EMPLOYER's contributions. `Total deductions` equals 2.5% of New Basic Salary in 6 of 7 rows (the employee's 1.5% + 1%), and equals CSG + NSF + PAYE in none. So putting the JSON's `CSG` and `NSF` on the employee's payslip would print the employer's amounts as deductions, and the lines would not add up to the total. The payslip needs the EMPLOYEE's CSG and NSF as separate fields. The cleanest way is to add them as company columns in the payroll app (for example "Employee CSG", "Employee NSF") and tick them in the PDF-fill export; they then arrive as extra keys. See section 3a for what I have confirmed, and decision D1 for where the employee's CSG and NSF come from.

**Rounding.** Net Pay in the sample has decimals in every row, while the template shows whole rupees. Rounding each line for display can make the visible lines differ from the visible total by a rupee (the same problem as the one-cent difference in the payroll app's known issues). See decision D3.

**Advance.** The reference lists "Advance" under Earnings and adds it into Total Earnings, which raises net pay. Whether that is right depends on what it means (an advance paid out, or an advance being recovered). See decision D4.

## 3a. Confirmed facts and calculation policy

Confirmed by me (the owner) from my real payroll column setup (checked on 6 October 2026; the file stays outside the repo), not checked against current legislation:
- The payslip shows the EMPLOYEE side only. The employer columns `CSG`, `NSF`, `Levy`, `PRGF`, `Total MRA contributions`, `EDF`, `EDF (monthly)` and `Total` never appear on it.
- Employee CSG: the payroll column "Employee CSG" (being renamed from "CSG - 1.5 %/ 3%", key `csg153`). Base: New Basic Salary (Basic Salary + Govt Increment). 1.5% when the base is at or below 50,000, 3% when the base is strictly above 50,000, applied to the WHOLE base (not marginal), no cap. Test 50,000 and 50,000.01.
- Employee NSF: the payroll column "Employee NSF" (being renamed from "NSF - 1%", key `nsf1`). 1% of min(base, 29,710), so at most Rs 297.10. The base is currently Gross Pay, which I am confirming. The current payroll formula has a bug (the rate is 0 at or above 29,710) that I am fixing in the payroll app. Test 29,709 / 29,710 / 29,711, which give 297.09 / 297.10 / 297.10.
- Employee NSF is 0 when `Age 60+` is ticked (owner rule). There is no part-time exemption. My payroll setup does not have the 60+ rule yet; I am adding it.
- Gross Pay = Basic Salary + Govt Increment + Allowances + Travelling. Total deductions = Employee CSG + Employee NSF + PAYE. Net Pay = Gross Pay - Total deductions. Each payroll column is rounded to 2 decimals on its own, and the payroll totals add the unrounded values, so a payroll total can differ by 0.01 from the sum of the lines shown.
- PAYE: the column "PAYE" (key `paye`). A second column (key `paye_other`) is being renamed to "PAYE (calculated)"; it is never mapped.
- Until the renames are done, the old names "CSG - 1.5 %/ 3%" and "NSF - 1%" are accepted as aliases in the mapping, each shown as an "old name" warning.
- The employer's NSF is 2.5% and the employer's CSG is 3% or 6%; those are the JSON's `NSF` and `CSG` columns. The reference template's own NSF formula has no ceiling, so it is wrong above 29,710.
- Rates, ceilings and thresholds change. They are never constants in the code: wherever the app uses one, it is a visible setting with an effective date.

**Mapping (built-in Table template).** Basic Salary from `Basic Salary`; Govt Increment from `Govt Increment`; Allowances from `Allowances` (a NEW earnings line, not in the reference, so that Total Earnings can equal Gross Pay); Transport Allowance from `Travelling`, labelled "to confirm"; CSG from `Employee CSG`; NSF from `Employee NSF`; PAYE from `PAYE`. Presence Bonus, Productivity Bonus, Advance, Absences and Lateness are unmapped and show "-". If two keys with the same name ever appear in a row, that is an error.

**Main rule for the cross-check.** It must calculate EXACTLY as the payroll app SHOULD: the rules above, with the payroll app's own arithmetic (floating point, then `toFixed(2)`), otherwise it warns on every payslip. It uses the CORRECT rules even where the payroll app still has a bug, so it flags the bug: an NSF of 0 at or above 29,710, and any 60+ employee with an NSF above 0. Where the payroll app and the reference template disagree, follow the payroll app by default and tell me. A zero or negative base gives 0.

Calculation policy (fixed, do not ask):

| Lines | Treatment |
|---|---|
| Basic, increment, allowances, bonuses, advance, absences, lateness | Copy from the payroll data |
| PAYE | Always copied, never calculated (the reference has a typed 0) |
| Employee CSG and NSF | Copied from the payroll columns "Employee CSG" and "Employee NSF" (decision D1, option A). Never taken from the JSON's `CSG` and `NSF` |
| Total Earnings, Total Deductions, Net Pay | Calculated on the page by plain addition of the lines shown |

- DECIDED (owner): the employee's CSG and NSF are COPIED from the payroll columns "Employee CSG" and "Employee NSF". They arrive as keys in the JSON rows, and the hub keeps them in `payroll_entries.extra` as `employee_csg` and `employee_nsf`. I change the columns in `payroll_sys` myself; the payslip app never touches `payroll_sys`. A missing "Employee CSG" or "Employee NSF" is a visible error for that employee. The fake fixtures carry both keys.
- The payslip app calculates only the three totals. They are compared with the payroll's `Gross Pay`, `Total deductions` and `Net Pay`. Any difference is a visible per-employee warning that blocks the export until I accept or fix it. Net Pay is the deciding check. Never adjust a line to make it fit.
- A difference of exactly 0.01 on a total is labelled "rounding" and may be accepted in bulk; each one is still listed per employee. Any other difference is accepted one by one.
- Cross-check (WARNING ONLY): the app recalculates the employee's CSG and NSF from the Statutory rates settings (below) and shows any difference from the copied figure per employee. It never replaces the copied figure and never blocks the export.
- A copied figure with more than 2 decimals is a visible error naming the employee and the line. It is never rounded.
- A standalone file without `Company Name`, `Address` or `BRN` is a visible error with the hint "tick Company Details in the payroll export".

**Statutory rates settings (required, used by the cross-check only).** A Settings page where an admin edits, per company: employee NSF rate (1%), NSF salary ceiling (Rs 29,710, with the resulting maximum NSF, Rs 297.10, shown next to it), employee CSG lower rate (1.5%), higher rate (3%) and salary threshold (Rs 50,000), and "NSF exemption at 60+" (ON by default, using the `Age 60+` field). Each version has an "effective from" month. Which payroll column is the base (New Basic Salary for CSG; Gross Pay for NSF, "to confirm") is a mapping kept with the template, not a rate. Rules:
- Rates are versioned, never overwritten: a new rate is a new row with an effective-from month. A payslip for a month uses the rates in force for THAT month, so re-checking an old month gives the old result. A wrong rate is corrected by a new revision row, never by an edit.
- Every issued payslip stores a snapshot of the rates its cross-check used, so it can be audited later.
- Validation: rate between 0 and 100 %, ceiling and threshold not negative, effective-from is a month start; show a before/after confirmation on save and keep a change log (who, when, old, new).
- Admins only, saved through the hub like templates. When opened standalone, defaults are shown and clearly labelled as unsaved.
- The Settings page shows the current values and a worked example (salary in, NSF and CSG out) so a wrong rate is obvious.
- The hub table (`statutory_rates`) is SHARED, not payslip-only: later the payroll app will read its rates from it through the hub. Column names and the bridge dataType (`statutory-rates`) are generic, versions are effective-dated and insert-only, and it holds no payslip-specific fields.

**Calculation and display rule (owner decision).** Lines are copied exactly, so the only arithmetic on the page is the three totals: add the lines as shown in whole cents (integer maths, no floating point). Nothing is rounded: a figure with more than 2 decimals is an error (above). Display: a whole amount shows with no decimals (1,000); an amount with a fractional part shows 2 decimals (1,000.50); a zero shows as "-" (accounting style, as in the reference). The same rule applies in the preview, the PDF and the Excel file (Excel: number format that shows 0 or 2 decimals but stores the 2-dp value). The cross-check is the exception: it repeats the payroll app's own arithmetic (floating point, then `toFixed(2)`), not integer cents.

## 4. How the app works

**The layout model.** A payslip is described by data, not code: a template is a list of blocks (title band, company block, employee info, earnings list, deductions list with groups, totals, net pay, sign-off). Each line has a label and a source field. One layout model is rendered by three writers: the on-screen preview, the PDF writer and the Excel writer, so they cannot drift apart. The PDF is built from the layout model, never from Excel.

**Field mapping.** Each line is bound to a source key. The template editor shows a dropdown of the keys actually found in the data. A mapping that points to a key missing from the data is an error shown before generating, naming the employee and line. Numbers must be numbers: text in a money field is an error.

**Arithmetic and reconciliation.** Totals on the page are the sum of the lines shown, and the app checks them against the payroll system's own `Total deductions`, `Gross Pay` and `Net Pay`. Any difference is a visible warning per employee, and the payslip is not marked ready until I accept or fix it. Never adjust a line to make it fit.

**Excel file.** Same layout, fonts, colours, merged cells, borders and number format as the reference. Employee values are plain numbers. Total Earnings, Total Deductions and Net Pay may be live formulas so the sheet works in Excel (decision D9). The sheet is set to one page, portrait.

**PDF.** Built from the layout model with an embedded font (decision D8). Paper size per decision D7. The embedded font is a subset of the bundled font file, the one the preview loads; its header is corrected after embedding (known issue 29).

**Employee data from the hub.** Date of Employment is not in the payroll data. Decision D5.

## 5. Phases (stop after each for review)

- **Phase 0, plan only.** Read everything, reply with a plan, risks and ALL questions at once (lettered options).
- **Phase 1, standalone.** Scaffold, design system, import a payroll JSON file (validated with Zod, row-level errors, trimmed strings), pick the month and the employees, the layout model and the built-in Table template, preview of one payslip at a time, the arithmetic and mapping checks, PDF per employee (zip), Excel export. Safety-net tests first. The lookup template appears as a "Coming soon" card.
- **Phase 2, hub bridge.** Copy `bridge.js` unchanged, `init({ appId: "payslip", onData })`, "Get from dashboard", the same waiting-data notice and import preview behaviour as `pdf-form-filler` (data arriving while another is open asks Add/Replace, newer waiting data replaces older, memory only). Hub side, as its own task in the payroll-hub repo: give the registry entry its URL and set it active.
- **Phase 3, templates in the database (hub task + app task).** Tables for templates with draft and publish: a draft is edited freely, Publish creates an immutable version with who and when, and issued payslips record the version they used. Bridge messages (save-template, load-template, list-templates) validated on both sides, size-limited, with a version check that refuses a save if someone else changed the template since it was opened. Template editor built from blocks (labels, order, source fields, colours, show/hide blocks, logo), not a free-form designer.
- **Phase 4, issued payslips.** Store a snapshot per employee per month (template version, who issued it, when, and the exact values shown). Issued payslips never change; a correction creates a numbered revision. Issuing a payslip again with nothing changed is allowed, after a second confirmation. An issued payslip is always drawn with the drawing version it was issued with (docs/ISSUED_PAYSLIP.md). Admin only, behind the hub's password gate.
- **Phase 5, month review.** Compare each employee with last month: highlight what changed (each earnings and deduction line), bulk-approve the unchanged ones. The payslip is always generated from the CURRENT month's figures. Never copy last month's stored payslip and only change the date. Built as decision D19 says.
- **Phase 6, lookup template.** A workbook with a data sheet and a payslip sheet that fills from an employee ID with INDEX/MATCH or XLOOKUP. The PDF still comes from the layout model.

## 6. Security and privacy

- Payslips contain salaries and national ID numbers. Generation is client-side; nothing is stored in the browser; PDFs and Excel files stay in memory until downloaded and are cleared on logout and when the data is replaced.
- Stored payslips and anything read from the hub are admin-only and require the hub's password gate. The hub's rules are the real enforcement; the app hides what a viewer must not see but does not rely on it.
- Sensitive values (NIC, amounts) are never logged. A run log, if kept, holds no values (who, when, company, period, count, template version).
- Delivery is download only for now. No email, no employee portal.
- The same-origin risk of the hub applies (see the hub's README). Fine for a personal tool on fake data; settle it before real employee data goes in.

## 7. Tests (fake data only)

- Recordings on the untouched logic: the layout model for a fixed set of employees; the Excel file read back (cell values, merged ranges, number formats, fonts, fills, borders); the PDF read back with pdf.js (text, page, position rounded to 0.5pt, font and size, not raw bytes), plus its fonts read from the PDF itself with a strict reader (embedded, valid header, the bundled glyphs, each advance equal to the font's own width). Prove each fails on a deliberate one-value change, then revert.
- Reconciliation tests with hand-calculated examples: lines add up, a mismatch is reported, a missing key is reported, text in a money field is reported, a zero shows as "-".
- Bridge tests: valid rows reach the import, invalid rows are refused with a message, a duplicate message id is not imported twice, nothing is written to browser storage.
- Month review tests, with a fake August 2026 issued through the app's own code: Unchanged, Changed, New and Left; a one-cent change; a template change (a new version, and another template matched by label); a rates change; what cannot be compared; marks, bulk-approve and what blocks an issue; the payroll fallback. The payslips to issue are proved to be the same with or without a review.
- Scripts: encoding check, contrast and focus checks for both themes, reduced motion, names on every control, keyboard behaviour of dialogs and menus, production build with 0 outside requests.

## 8. Decisions (answered in Phase 0; ask me before changing any; do not guess)

- **D1. Employee CSG and NSF. DECIDED: option A (copied).** They come from two new payroll columns, "Employee CSG" and "Employee NSF" (in the JSON rows, and in `payroll_entries.extra` as `employee_csg` / `employee_nsf`). I add the columns to `payroll_sys` myself. A missing one is a visible error per employee. The payslip app calculates only the three totals. The Statutory rates settings stay, versioned, as a WARNING-ONLY cross-check (see 3a). Option B (calculate them in the payslip app) is dropped.
- **D2. Company columns. DECIDED:** Transport Allowance is mapped to `Travelling`, labelled "to confirm" in the mapping until I confirm it. Presence Bonus, Productivity Bonus, Advance, Absences and Lateness stay unmapped until I pick a column from the keys found in the data. An unmapped line is shown with "-", as in the reference. A mapped key that is missing for an employee is an error naming the employee and the line, with a "treat as zero" accept.
- **D3. Rounding and decimals. DECIDED:** 0 decimals for whole amounts, 2 for fractional ones, zero as "-", totals add the lines shown, integer-cents maths (see 3a). A total that differs from the payroll's by exactly 0.01 is labelled "rounding" and can be accepted in bulk, each still listed per employee.
- **D4. Advance. DECIDED for now:** it stays an earning, as in the reference, until I confirm otherwise.
- **D5. Date of Employment. DECIDED:** a real column on the hub's `employees` table, edited in the hub. In Phase 1 the line is blank unless the imported file has a `Date of Employment` key.
- **D6. Output. DECIDED:** one PDF per employee in a zip; one Excel workbook with a sheet per employee. PDF file names are "SURNAME Other names - YYYY-MM.pdf"; if two names clash, add " (2)". Never the NIC in a file name.
- **D7. Paper size. DECIDED:** A4.
- **D8. Font. DECIDED, final after I see the preview:** TeX Gyre Pagella (a free Palatino-style font) embedded in the PDF and used by the preview; Book Antiqua named in the Excel file. I check the GUST Font License before real use.
- **D9. Excel formulas. DECIDED:** live formulas for the three totals only. Every other cell is a plain number from the payroll data, including CSG and NSF (unlike the reference, where they are formulas).
- **D10. Repo name and URL. DECIDED:** `payslip`, at https://noor1290.github.io/payslip/ . Local `git init` only; I create the GitHub repo and push myself.
- **D11. Statutory rates scope. DECIDED:** per company, in a shared, generic `statutory_rates` table (see 3a). A wrong rate is corrected by a new revision row, never an edit.
- **D12. Cross-check rules. DECIDED from my real column setup (see 3a):** CSG on New Basic Salary: 1.5% at or below 50,000, 3% strictly above, on the whole base, no cap. NSF: 1% of min(base, 29,710), base Gross Pay ("to confirm"); the ceiling Rs 29,710 is the stored setting and the maximum NSF Rs 297.10 is shown beside it. "NSF exemption at 60+" is ON by default; no part-time exemption. The cross-check uses these CORRECT rules with the payroll app's own arithmetic (floating point, then `toFixed(2)`), so it flags the two payroll bugs I am fixing (NSF 0 at or above 29,710; no 60+ rule). A zero or negative base gives 0. The three totals stay integer-cents.
- **D13. Month comparison baseline. DECIDED:** last month's issued payslips, falling back to last month's payroll run. "Last month" is the calendar month before the pay month, and the latest revision of each payslip. The fallback is used only when NO payslip at all was issued last month; it puts that month's payroll figures on the template in use now and is labelled "compared with payroll figures, not issued payslips".
- **D14. Name, address and labels. DECIDED:** the name is "SURNAME Other names"; a one-part address leaves line 2 blank; the reference's exact labels are kept in Phase 1 and become editable in Phase 3.
- **D15. Bridge. DECIDED:** `bridge.js` stays unchanged; new operations travel inside `send-data` and `request-data` with new dataTypes. The hub-side work is a numbered list in `docs/HUB_CHANGES.md`; the payslip task never touches the hub repo.
- **D16. Packages. APPROVED:** runtime: react, react-dom, zod, lucide-react, tailwindcss with @tailwindcss/vite (Tailwind v4), the two Geist font packages, pdf-lib, @pdf-lib/fontkit, exceljs, fflate. Dev: vite, typescript, vitest, pdfjs-dist, playwright, oxlint. Exact versions pinned. The production build must make 0 outside requests. Ask before adding anything else.
- **D17. Reference files. DECIDED:** `docs/reference/` holds a rebuild of the template with ABC Co Ltd and fake names. The original `Book1.xlsx` and `Book1.pdf` are never copied or committed; both names are in `.gitignore`.
- **D18. Fixtures. DECIDED:** hand-calculated ABC Co Ltd rows that carry "Employee CSG" and "Employee NSF"; the hub's fake sample is kept as the mismatch fixture.

- **D19. Month review rules. DECIDED (8 October 2026):**
  - One row per employee: Unchanged, Changed, New (not issued last month), Left (issued last month, not in this month's data), or "cannot be compared" with the reason. Each status is text with an icon.
  - Only money decides a status: a line or one of the three totals that differs by a cent or more, or a line without exactly one partner. A name, a date of employment, a reworded label, the template version and the rates version are shown as notes on the row and never change its status.
  - Lines are matched by their id within the same template, and by label across templates (same side of the page, capitals and extra spaces ignored). A label used twice, or with no partner, is "not matched", with its amount.
  - A banner says when the template version or the rates version is not last month's. Rates only feed the cross-check warnings.
  - Before a month is issued: last month must be loaded or found to have nothing to compare with (a declined or failed load blocks, with "Ask again"); every selected Changed, New and not comparable payslip is reviewed one by one; Unchanged ones are approved too, in one click (bulk-approve touches Unchanged rows only); everyone who Left is acknowledged. With nothing to compare with, no review is needed.
  - Downloads do not wait for the review. The identical re-issue rule (known issue 24) still applies.
  - Review marks are in memory only and are dropped when the figures or the baseline change. An audit trail is a later hub task (`docs/HUB_CHANGES.md`, item 13).
  - The review lives in a card on the Payslips page, under the employee list. The paper preview is never tinted, highlighted or marked.
  - "Get from dashboard" keeps asking for the latest run (known issue 10 stays open).

## 9. Coming soon (do not build now)

- The lookup-style template (Phase 6). Show it as a disabled "Coming soon" card in the template picker.
- Email delivery or an employee portal.
- Password-protected PDFs.
- A free-form template designer.
- Year-to-date totals and leave balances (not in the data today).
