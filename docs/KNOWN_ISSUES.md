# Known issues

Found while building Phases 1 to 3 (October 2026) and deliberately not changed, because each one needs the owner's decision. All evidence uses fake data (ABC Co Ltd).

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

**Phase 3.** This is now only true when the app is opened on its own. Inside the dashboard the app uses the company's saved rates and nothing else; for a month before the first saved version it says "The rates saved in the dashboard start in ..., after this pay month, so CSG and NSF were not cross-checked."

**To decide.** The real effective dates of the versions you save.

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

## 12. The rates history says "You" or "Another admin", never a name

**What happens.** The dashboard sends `created_by_you` (true or false) and never a user. So the version history shows "You, 7-Oct-26" or "Another admin, 7-Oct-26". The same holds for who saved a template draft.

**Evidence.** `docs/INTEGRATION.md`, statutory-rates ("never a user id"). Test: `tests/hubSettings.test.ts`, "loads every version".

**To decide.** Whether the hub should later send a display name. The app ignores fields it does not know, so adding one in the hub breaks nothing here; showing it is a small change in this app.

## 13. The app only learns that I am not an admin when a save is refused

**What happens.** Nothing in the contract tells the app the role of the user. The editing controls are shown; the first save refused as `forbidden` turns that company read-only for the session, with the reason. "Reload" forgets it, so a role changed in the dashboard is found by the next save.

**Evidence.** `npm run check:bridge`: "Only an admin of this company can save", then the save buttons are off.

**To decide.** Whether the hub should say the role in `meta`, so the page can be read-only from the start.

## 14. The template to use is chosen again each time the app opens

**What happens.** Nothing is stored in the browser, so the choice of template is not remembered. Each time: with exactly one published template it is preselected; with more than one I must pick, and payslips cannot be exported until I do; with none the built-in Table is used. The Payslips page always shows which template and version is in use.

**To decide.** Whether the hub should keep a "default template" per company.

## 15. Only the latest published version of a template can be chosen

**What happens.** The list from the dashboard gives the latest published version of each template. The app offers that one. An older version can still be loaded by its number through the bridge, but there is no control for it.

**To decide.** Whether an older version needs to be selectable, for example to re-create an old payslip. Issued payslips (Phase 4) will record the version they used.

## 16. A template cannot be deleted, and a group of deductions cannot be added or removed

**What happens.** The dashboard has no action to delete or archive a template (its FUTURE_WORK.md, section 9c), so the app has none either. In the editor, the two deduction groups can be renamed but not added or removed, and a line cannot be moved from one group to the other (remove it and add it again).

**To decide.** Whether either is needed.

## 17. A label that is too long is found on the payslip, not in the editor

**What happens.** The editor limits a label to 60 characters. Whether a label fits its column depends on the font, so a label that is too wide, or a character the payslip font cannot print, shows up as an error on each payslip (as for a long name, issue 1), not while typing.

**Evidence.** By the same rule as issue 1 (`src/lib/build.ts`, "is too long to fit on the payslip"). Not tried with a real long label.

**To decide.** Whether the editor should measure labels while typing.

## 18. After a stale template save, my changes are listed, not merged

**What happens.** As decided: the newer draft is loaded into the editor and my unsaved changes are listed beside it (kept in the memory of this tab until I press "I am done with this list"), to be redone by hand. Nothing is reapplied automatically. Closing the tab loses the list; the browser asks first.

**To decide.** Nothing now.

## 19. Each rates or template request to the dashboard is given 15 seconds

**What happens.** The bridge file itself would wait 120 seconds for a request. The app stops waiting after 15 and says "The dashboard did not answer", with "Check again". A save uses the 10 seconds of the bridge. After either, a save is never resent before a successful reload has shown whether it was stored.

**Evidence.** `npm run check:bridge` measures the wait (about 15.5 s), which is why that check now takes about 40 seconds.

**To decide.** Nothing now.

## 20. The real dashboard side of Phase 3 was only tested against a stand-in

**What happens.** As for issue 9, the bridge only trusts the deployed dashboard. The rates and template flows were run in the built app against an in-memory stand-in (`scripts/lib/fake-hub.mjs`) written from `docs/INTEGRATION.md` and the handlers in the hub repo (read only). It keeps to the contract, but it is not the hub.

**To decide.** Nothing. To see it for real: run migrations 0008 to 0010, deploy the hub with its Stage B code and this app, then follow the test list in the Phase 3 report.
