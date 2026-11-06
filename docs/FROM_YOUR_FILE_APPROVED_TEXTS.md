# "From your file": approved on-screen text

Stage 1, approved by the owner on 2 November 2026. `...` stands for a name, number or cell filled in at the time.

## Template page: the card
- From your file
- Upload your own payslip layout as an Excel file, and choose what goes in every cell.
- Upload an Excel file / Reading the file
- Choose an Excel file ending in .xlsx.
- The file could not be read. Choose it again.
- Start from this file? (when unsaved changes would be lost)

## Refused uploads
- This is not an Excel (.xlsx) file this app can read.
- The file has no sheets.
- The first sheet is empty.
- A payslip layout has at most 80 rows and 30 columns. This sheet has ... rows and ... columns.

## After an upload (blue notice, "From your file")
- The file has ... sheets. Only the first, "...", is used: one sheet is one payslip.
- Images and logos are left out: the dashboard does not store them in a template.
- ... cells with numbers, dates or formulas start Empty, so that no real figure is stored. Choose what goes in each one.
- Text with several styles in one cell keeps the style of the cell.
- The preview and the PDF print ... in TeX Gyre Pagella, the font the app carries. The Excel output keeps your fonts.

## The grid
- Rows: Add above, Add below, Remove row
- Columns: Add left, Add right, Remove column
- History
- Click a cell, or a merged block, to choose what goes in it.
- Nothing is in this cell yet. / Use this cell
- For screen readers: Cell B4: Text as typed

## The cell panel
- Cell ... / Merged block ...
- In the uploaded file: ...
- What goes in it: Text as typed, Fixed value, Company detail, Employee field, Payroll figure, A small calculation, Date of employment, Pay month, Today's date, Another date field, Empty
- Text
- Value for all companies / ... has its own value / Value for ... only / badges: All companies, ... only
- Detail: Company name, Address, BRN, VAT
- Field: Full name, NIC (ID), and the fields found in the data
- Payroll figure
- Date field
- The date on the payslip, on the Payslips page. It starts on today.
- How it is written
- In capitals
- Decimals: None for a whole amount, otherwise 2 / Whole rupees, half up / Always 2
- Thousands separators / Write "Rs" before it / A dash for 0
- 18,750.50 is written ...
- 15 March 2021 is written ...
- Add a piece / Remove the last piece
- Parts, worked out in order / Rounding: Part by part, as set below / Add the exact values, round the total once
- Part ...: Add, Subtract / What: Payroll figure, Another cell, A number / Figure / Cell / This cell / Number
- Multiplied by (optional) / Round this part first: No, To whole rupees, half up, To 2 decimals, half up
- Remove / Add a part
- Write a number, such as 0.045 or 4.5%.
- For the month review / Side of the payslip: Neither, Earnings, Deductions / Name of this figure
- On the payslip / (empty) / For ... (the employee)
- Get payroll data on the Payslips page to see this cell with real figures.

## History
- History / Close
- Version ... / ..., by you / by another admin / Restore
- Loading the versions from the dashboard.
- No version has been published yet.
- Version ... is in the editor. Save the draft to keep it, then publish it as a new version.

## Saving and the Payslips page
- This company's own values are saved.
- Chip: From your file (not saved) (opened on its own, outside the dashboard)
- Payslips from your own file can be previewed and downloaded. Issuing them comes in the next stage. (Temporary: goes away with Stage 2.)

## Problems shown for a layout or an employee
- Cell ...: the payroll data has no "..." for this employee.
- Cell ...: "..." is text, not a number. / Cell ...: this is text, not a number.
- Cell ...: "..." has more than 2 decimals; it is not rounded here, so fix it in the payroll app.
- Cell ...: "..." is too large to be an amount.
- Cell ...: this cannot be read as a date.
- Cell ...: the calculation uses its own cell.
- Cell ...: the calculation goes round in a circle through other cells.
- Cell ...: the calculation uses a cell that is no longer in the layout.
- Cell ...: the calculation has too many decimals.
- Cell ... uses "...", a column that must never be on a payslip (employer side, or the second PAYE column).
- Cell ... does not say which date field it shows.

## Stage 2 prompt, Stage 1: long names, the split address, page settings (approved 6 November 2026)

### Cell panel
- Detail: Address, before the last comma / Address, after the last comma / Address on two lines, split at the last comma
- The address is split at its last comma: one cell shows the part before it, another cell the part after it.
- The address is split at its last comma onto two lines; the row grows when the two lines need more height.
- A long name is set smaller, never below 9 points, then put on two lines; its row grows when it needs to. It is never cut off.

### Template page: the Page card
- Page / Orientation: Portrait, Landscape / Margins: Normal, Narrow / Fit the sheet on one page
- It prints at ...% of its size in Excel.
- Below 85%, the payslip prints small: 11-point text prints at about ... points. Try narrow margins or landscape, or make the columns narrower in Excel.
- At 100%, the sheet is larger than one A4 page. On the Template page, tick "Fit the sheet on one page", or make the sheet smaller in Excel.

### Problems shown for a layout
- The address split at its last comma needs one cell for the part before the comma and one cell for the part after it.
