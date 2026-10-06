# Payslip

One of the apps in Payroll Hub. It turns one month of payroll results into a payslip per employee: a preview, a PDF and an Excel file, all drawn from one layout model. Everything runs in the browser and nothing is stored in it.

- What it must do and the decisions behind it: [docs/BRIEF.md](docs/BRIEF.md)
- Look and feel: [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)
- Work needed in the hub: [docs/HUB_CHANGES.md](docs/HUB_CHANGES.md)
- Things found and not changed: [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)

Fake data only: the company is ABC Co Ltd, and no name, ID or figure in this repo belongs to a real person.

## Run it

```
npm install
npm run dev
```

Then import `samples/ABC Co Ltd-pdf-fill-2026-09.json`, or press "Try with fake sample data".

## Checks

| Command | What it checks |
|---|---|
| `npm test` | Calculations, import, the dashboard bridge, and the recordings of the layout model, the Excel file and the PDF read back |
| `node scripts/prove-tests-can-fail.mjs` | Changes one value at a time and expects the tests to fail |
| `npm run check:encoding` | No mojibake, no changed non-ASCII character |
| `npm run lint` and `npm run typecheck` | Lint and TypeScript strict |
| `npm run build` then `npm run check:build` | The built app makes 0 requests to outside servers and writes nothing to browser storage |
| `npm run check:bridge` | Inside a (fake) dashboard frame with the real bridge file: data waits until confirmed, a repeated message is not imported twice, invalid rows are refused, Add to and Replace, nothing stored |
| `npm run check:a11y` | Names on controls, focus ring, contrast in both themes, reduced motion, dialog keyboard behaviour |

A recording in `tests/expected/` is rewritten only on purpose: `UPDATE_RECORDINGS=1 npm test`.
