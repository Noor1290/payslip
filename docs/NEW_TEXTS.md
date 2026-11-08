# On-screen texts waiting for the owner's approval

Branch `cleanup`. Each line says where the text is, what it said and what it says now. Once approved, the entries move into the approved list they belong to and are removed here.

Waiting (Stage 3, 8 November 2026):

1. **"From your file", a date cell, "How it is written"** (`src/components/SheetCellEditor.tsx`, known issue 47). New box label: **Text before the date**. Nothing was there before.
2. **Import error, missing ID** (`src/lib/payrollFile.ts`, TODO C21).
   Was: `Row 3: ID is missing or is not text.`
   Now: `Row 3: the field "ID" is missing, empty or not text. Each employee needs a field named exactly "ID".`
3. **Import error, missing surname** (`src/lib/payrollFile.ts`, TODO C21).
   Was: `Row 3: Surname is missing or is not text.`
   Now: `Row 3: the field "Surname" is missing, empty or not text. Each employee needs a field named exactly "Surname".`

The phone-width fix (TODO C20) changes no text: the section buttons at the top now wrap onto a second line.
