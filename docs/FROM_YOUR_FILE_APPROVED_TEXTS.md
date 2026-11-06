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
- ~~Payslips from your own file can be previewed and downloaded. Issuing them comes in the next stage.~~ (Temporary; removed 6 November 2026, when issuing came.)

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

## Stage 2 prompt, Stage 2: cross-checks, required cells, Treat as zero (approved 6 November 2026)

`...` is a name, number or cell. A cell in a message is named "C11 (NIC)": its place, then the text to its left or the name given to the figure; in the checks card, by its place only.

### Cell panel
- This cell is the payslip's: Not a total / Total earnings, checked against Gross Pay / Total deductions, checked against Total deductions / Net pay, checked against Net Pay
- Required / When it is empty, it is listed before a download, and the payslip is not issued.

### Problems shown for a layout
- Cell ... is marked as Total earnings, but it shows no payroll figure or calculation. (or Total deductions, Net pay)
- Only one cell can be Total earnings: ..., ... are. (or Total deductions, Net pay)

### Payslips page: the checks card
- Total Earnings, cell C18 / Total Deductions, cell E18 / Net Pay, cell E20 (the cell where each is), each "against" its payroll total as today
- Warning: No cell of the layout is marked as Total earnings, Total deductions or Net pay, so this payslip is not checked against the payroll's totals.
- Warning: Cell ... is required, and it is empty.
- Treated as zero. Cell ...: (reason)

### Treat as zero for a cell
- Treat cell ... as zero?
- ...: the payroll data has no figure for cell .... The cell will show 0, written as its format writes it. No other figure is changed.

### Before a download
- 1 required cell is empty / ... required cells are empty
- Fill them in, or download anyway. A payslip with an empty required cell cannot be issued.
- ...: cell ... (one line per payslip)
- Go back / Download anyway

### Issuing
- Before payslips from your own file are issued, mark the cells of Total earnings, Total deductions and Net pay in the layout, on the Template page.
- ...: a required cell is empty: .... / ...: required cells are empty: ..., ....
