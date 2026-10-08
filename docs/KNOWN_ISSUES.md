# Known issues

Found while building Phases 1 to 4 and fixing the PDF font (October 2026) and deliberately not changed, because each one needs the owner's decision. All evidence uses fake data (ABC Co Ltd).

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

**Phase 4.** Settled: the dashboard now sends `meta.role` with every answer about rates, templates and issued payslips, and a member sees read-only from the start. The first refused save still does the same, in case the hint is missing.

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

**To decide.** Nothing. To see it for real: run migrations 0008 to 0010, deploy the hub with its Stage B code and this app, then follow the test list in the Phase 3 report. The same holds for issued payslips (Phase 4): migration 0011 and the hub's Stage C code.

## 21. A month too large for one message is issued in batches, so it is not all-or-none as a whole

**What happens.** The dashboard stores one message all or none, and accepts at most 1,000 payslips and 4 MB per message. A larger month is sent in batches, one after the other. Each batch is all or none; the month as a whole is not. If a batch does not go through, the run stops there, and the panel says "Stopped at batch 2 of 3" and lists who is issued and who is not. The reload rule is applied to the batch that stopped.

**Evidence.** Measured on the fake fixtures: a whole payslip as sent is 5,918 to 6,078 bytes, so about 657 fit in one message. A company under about 650 employees is always one message. With the largest template the editor allows (10.7 KB of lines) about 360 fit. Test: `tests/issue.test.ts`, "more than fits is split into batches" (1,500 payslips).

**To decide.** Nothing now.

## 22. A payslip over 16 KB cannot be issued

**What happens.** The app measures each payslip before sending. One over the dashboard's 16,000 bytes stops the whole issue before anything is sent, naming the employee and the size. Nothing is trimmed. A normal payslip is about 6 KB; the largest template the editor allows gives about 11 KB.

**To decide.** Nothing now. It would only be reached with a much larger template than the editor allows.

## 23. The dashboard asks me each time the app loads a month

**What happens.** "Check what is issued", "Open the month", the reload after a stale issue, and the reload after an issue that got no answer each ask in the dashboard, and need it unlocked. If I say no there, the app says so and nothing is known yet: after an unanswered issue it offers "Check again", never a resend.

**To decide.** Nothing here; it is the dashboard's rule for per-employee data.

## 24. An identical payslip can be issued again, after a second confirmation (decided)

**What happens.** After a month is issued, "Issue" stays available. A selected payslip that is exactly what the dashboard has as its latest revision (the same lines, template version, rates and accepted differences with their reasons) is not sent on the first confirmation alone. A second one asks: "Nothing has changed since revision N. Issue an identical revision N+1 anyway?", names each such employee, and starts on Cancel. Cancel sends nothing, for anybody in the selection. When the unchanged payslips are not all at the same revision, the question names no revision and each line does.

**Evidence.** `tests/issue.test.ts` ("an identical re-issue is allowed, but asked about a second time"); `npm run check:bridge` drives the two dialogs in the built app: Escape and Cancel send nothing, "Issue anyway" adds exactly one revision.

**To decide.** Nothing now. The employee list still says "Issued, revision N" from the lines alone, so a payslip can show as issued and not be asked about, when only its rates or a reason changed.

## 25. Only the latest revision of an issued payslip can be opened

**What happens.** The dashboard returns the latest revision of each payslip. Earlier revisions stay stored but cannot be opened from this app yet.

**To decide.** With the history, later.

## 26. An issued payslip is drawn with the drawing version it was issued with (decided)

**What happens.** The rule is now a hard rule in CLAUDE.md: format 1 must always render identically, and a change to the page geometry or the drawing is a new drawing version beside the old one. The stored lines record the drawing version (`drawing: 1` in the document object). The page geometry, the PDF writer and the Excel writer are marked as drawing version 1 and refuse a version they do not have; a stored payslip with such a version is listed as "cannot be shown", with the reason. A payslip issued before the key existed has no `drawing`: it is read as 1, the only version there was, and still compares as the same payslip.

**Evidence.** `tests/format1.test.ts` holds one payslip as stored (`tests/frozen/format-1/lines.json`, DOE JANE, fake) and the page, PDF and Excel sheet it must always give. Those files are written once and are not rewritten by `UPDATE_RECORDINGS`. When they were made they were equal to the existing recordings of the same payslip.

**To decide.** Nothing now. There is one drawing version, so nothing chooses between versions yet: the first change to the geometry has to add that choice (keep the present code as version 1, add version 2 beside it). The bundled font files are part of the drawing too: replacing them is a new drawing version.

## 27. Right after issuing, the date of issue is not shown until the month is opened again

**What happens.** The dashboard answers an issue with the revisions and one time for the whole message. The app marks those payslips as issued by me at once; their date appears after "Open the month again", which reads it from the dashboard.

**To decide.** Nothing now.

## 28. On a reopened payslip the template is named as it was when published

**What happens.** The template version is loaded only for its name. If it cannot be loaded the list says "Version N (name not available)" and the payslip is shown all the same.

**To decide.** Nothing now.

## 29. The PDF library writes a font header that viewers refuse; the app corrects one byte

**What happens.** When `@pdf-lib/fontkit` 1.1.1 makes the subset of a font to embed, it writes an unrelated number where the header of the font program holds its offset size (valid is 1 to 4; it wrote 14 for both payslip fonts). pdf.js accepts that. Chrome, Edge and xpdf refuse the font and draw a substitute sans-serif at the advances of the payslip font, which showed as gaps inside words ("A BC Co Ltd", "PA YE"). After pdf-lib has embedded the fonts, the app now sets that one byte to 4 (what the bundled font files carry, and what later versions of the library write) and refuses to write a PDF whose font header is wrong in any other way (`src/writers/fontProgram.ts`). Nothing else in the PDF changed: same drawing instructions, same width and character tables.

**Evidence.** On DOE JANE (fake data): xpdf reported "Embedded font file may be invalid" twice before and nothing after; Chromium showed the sans-serif before and TeX Gyre Pagella after. `tests/pdfFont.test.ts` reads the fonts from the PDF with a strict reader (`tests/cff.ts`) and fails on the old header; the PDF recordings now keep each font and its header; `npm run check:build` checks the PDFs downloaded from the built app.

**To decide.** Nothing now. Not seen in Adobe Acrobat (not installed here): worth one look. If the library is ever replaced or updated, the tests say whether the correction is still needed.

## 30. The preview draws long labels up to 0.1 point narrower than the PDF

**What happens.** The preview and the PDF use the same two font files and the same positions. The browser rounds each glyph advance to its own grid, so a text can end slightly earlier on screen than in the PDF. Left-aligned labels start at the same place; right-aligned amounts are short, so they move by less.

**Evidence.** In the built app, the largest difference is 0.085 pt, on "Date of Employment :" (97.07 pt on screen, 97.16 pt measured). With the CSS `text-rendering: geometricPrecision` on the payslip text it drops to 0.014 pt. `npm run check:build` measures it and accepts up to 0.25 pt.

**To decide.** Whether to add that CSS line to the preview.

## 31. Small things in how the PDF names its fonts

**What happens.** Three things pdf-lib does, all harmless while the font loads. The font is marked "symbolic" and not "serif", so a viewer that ever had to substitute it would pick a sans-serif. Every text on the page gets its own font resource name (53 names for 2 fonts on one payslip). The font names end in a number ("TeXGyrePagella-Bold-4482") in place of the usual six-letter prefix of a subset.

**Evidence.** Read from the PDF of DOE JANE (fake data): font descriptor Flags 4; 53 entries in the page font list pointing at 2 font objects.

**To decide.** Nothing now.
