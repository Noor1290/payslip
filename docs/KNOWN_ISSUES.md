# Known issues

Found while building Phases 1 and 2 (October 2026) and deliberately not changed, because each one needs the owner's decision. All evidence uses fake data (ABC Co Ltd).

## 1. A long name has little room on the payslip

**What happens.** As in the reference, the name sits in one column (about 115 points wide on the A4 page) because "Date of Employment :" starts in the next column. A name wider than that is set in a smaller size so it is never cut off; below 6 points the app stops and shows an error instead of printing over the next column.

**Evidence.** "PALMYRE JEAN MARC" (17 capitals) fits at the normal size with 4 points to spare. "LONGSURNAME-EXAMPLE Marie Anne" is set smaller. "VERYLONGSURNAME-HYPHENATED Firstname Secondname Thirdname Fourthname Fifthname" is refused. Tests: `tests/layoutModel.test.ts`.

**To decide.** Keep the reference layout, or move "Date of Employment" down to the NIC row so the name gets three columns.

## 2. The payroll's Total deductions differs by 0.01 from the lines for some employees

**What happens.** The payroll app rounds each column on its own and adds unrounded figures for its totals. The payslip adds the lines it shows. So Total Deductions can differ by exactly 0.01. The app labels it "rounding" and lets all of them be accepted together.

**Evidence.** In the fake fixture, 3 of 7 employees: DOE JANE has CSG 279.52 + NSF 210.85 = 490.37 on the payslip, and 490.38 in the payroll's `Total deductions` (279.525 + 210.85 = 490.375, rounded once).

**To decide.** Nothing in this app. It goes away only if the payroll app rounds each column before adding (its own known issue 1).

## 3. The cross-check sees the payroll's rounded bases

**What happens.** The cross-check recalculates CSG and NSF from the exported `New Basic Salary` and `Gross Pay`, which the payroll app has already rounded to 2 decimals. If a payroll input has more than 2 decimals, the payroll app calculates from the unrounded figure, and the cross-check could differ from it by 0.01 and show a warning.

**Evidence.** Not seen in the fixture (all inputs have at most 2 decimals). It follows from `pdfFillExport.js` line 82 in the payroll app.

**To decide.** Nothing now. It is a warning only.

## 4. The Excel totals rely on conditional formats to follow the display rule after an edit

**What happens.** Each total's number format is chosen when the file is written (0 decimals for a whole amount, 2 otherwise). Two conditional formats keep that true if someone edits a line in Excel. A spreadsheet program that ignores number formats in conditional formatting would keep the original format after an edit.

**Evidence.** Checked in Excel for Microsoft 365: all 7 fake sheets open without a repair prompt, recalculate to the same totals, and every cell displays exactly the text of the layout model.

**To decide.** Nothing now.

## 5. Download sizes are larger than estimated in the plan

**What happens.** The PDF code is 1.13 MB (505 kB compressed) and the Excel code 932 kB (258 kB compressed). Both load only when a download is asked for; the first screen loads 314 kB (96 kB compressed) plus fonts.

**To decide.** Nothing now. A smaller PDF library would mean giving up the embedded font.

## 6. `exceljs` depends on a `uuid` version with a moderate advisory

**What happens.** `npm audit` reports GHSA-w5hq-g745-h8pq in `uuid`, pulled in by `exceljs` 4.4.0 (its latest release, from 2023). The affected call (writing a UUID into a caller's buffer) is not used when writing a workbook.

**To decide.** Whether to keep `exceljs` or write the workbook XML directly later.

## 7. Before January 2026 there are no default rates

**What happens.** The built-in default rates start in January 2026. A payslip for an earlier month shows "No statutory rates are in force for this month" and is not cross-checked. It can still be exported.

**To decide.** The real effective dates, when the rates are saved through the hub (Phase 3).

## 8. The chosen theme is not remembered

**What happens.** Nothing is stored in the browser, so after a reload the app follows the system theme again.

**To decide.** Whether the theme is worth an exception to "nothing is stored in the browser".

## 9. The link with the real dashboard can only be seen after both are deployed

**What happens.** The bridge file only trusts the deployed dashboard at https://noor1290.github.io. It does not connect on localhost, and the dashboard still lists this app as "coming soon" with no URL.

**Evidence.** `npm run check:bridge` runs the built app in a frame under a stand-in dashboard page at that address (answered locally; nothing reaches the real site) and passes: ready, ping, data waiting until confirmed, a repeated message id, refused rows, Add to, Replace, "Get from dashboard", nothing in browser storage.

**To decide.** Nothing. To see it for real: deploy this app, then do item 2 of `docs/HUB_CHANGES.md` in the hub repo and deploy the dashboard.

## 10. "Get from dashboard" always asks for the latest run

**What happens.** The button asks the dashboard for its latest payroll run. There is no way yet to ask for a particular month from inside this app; the dashboard can still send any month it chooses.

**To decide.** Whether to add a month choice now, or with the month comparison in Phase 5, which needs last month's figures anyway.

## 11. "Add to" needs the same company, the same month and nobody twice

**What happens.** When data arrives while other data is open, "Add to" is offered only if the company and pay month are the same and no employee is in both. Otherwise the reason is shown and only "Replace" is possible. The PDF form filler adds freely; a payslip run should not mix months or count a person twice.

**To decide.** Whether that is strict enough, or too strict (for example, a corrected row for one employee cannot be swapped in; the whole month has to be replaced).
