# On-screen texts waiting for the owner's approval

Branch `cleanup`, 7 November 2026. Each line says where the text is, what it said and what it says now. Once approved, the entries move into the approved list they belong to and are removed here.

## Stage 1 (A8): the example date

The example date the app shows was the old fake date of employment, which may have come from a real payslip. It is now 22 March 2020 (still a day above 12, so day-first is plain, and still in March, so every text keeps its width).

| Where | Before | Now |
|---|---|---|
| Template page, "From your file", a date cell: the three ready-made formats (buttons) | the old date as d-mmm-yy, as dd/mm/yyyy, and its month and year | `22-Mar-20`, `22/03/2020`, `March 2020` |
| The same, the live preview (already in FROM_YOUR_FILE_APPROVED_TEXTS.md with the old date) | "(the old date, written in full) is written ..." | "22 March 2020 is written ..." |
| Payslips page, the error for a date of employment that cannot be read | "Date of Employment can't be read as a date. Write it as DD/MM/YYYY (for example (the old date)) or YYYY-MM-DD in the payroll app." | "Date of Employment can't be read as a date. Write it as DD/MM/YYYY (for example 22/03/2020) or YYYY-MM-DD in the payroll app." |

Not wording, but shown on screen: "Try with fake sample data" now shows DOE JANE with Basic Salary 23,600, Transport 3,150, employed 22-Mar-20, and the second employee as PLACEBO LUC HENRI.
