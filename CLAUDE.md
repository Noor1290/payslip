# Payslip app: project memory

A frontend-only app (React + Vite + TypeScript + Tailwind, GitHub Pages) that turns payroll results into payslips: a preview, a PDF per employee and an Excel file. It is one of the apps in Payroll Hub (https://noor1290.github.io/payroll-hub/) and gets its data from the hub through the postMessage bridge, or from a payroll JSON file when opened on its own. Full spec: **docs/BRIEF.md**. Look and feel: **docs/DESIGN_SYSTEM.md**. The reference template is in **docs/reference/**.

## Hard rules (never break these)
- The payroll figures are the product. Show the numbers exactly as the payroll system exported them. Never recalculate a payroll figure, never round one silently, never change a value to make a payslip "add up". If a payslip does not add up, show a clear warning and tell me.
- Do not guess which payroll field fills which line. Mapping is explicit, validated, and shown to me. A missing or wrongly typed field is a visible error, never a blank or a zero.
- Frontend only. The app never talks to Supabase. Saving and loading (templates, issued payslips) goes through the hub via the bridge; the hub's user must be signed in and an admin of the company.
- postMessage: only accept messages from `window.parent` AND the exact hub origin; the target origin is always the exact origin, never "*"; validate every message with Zod. Do not edit the copied `src/payrollHubBridge.js`.
- Payroll data lives in memory only. Never put it in localStorage, sessionStorage, IndexedDB, URLs, logs or analytics. Generated PDFs and Excel files stay in memory until downloaded.
- The repo is PUBLIC: fake data only (company "ABC Co Ltd", invented names and IDs) in tests, samples, screenshots and docs. Never commit a real payslip, real NIC numbers or real salaries. Never use or mention a service-role key.
- The app must keep working on its own, outside the hub, with a manually imported payroll JSON.
- No requests to outside servers at runtime: fonts, icons and libraries are bundled.
- Issued payslips are drawn from their stored format. Format 1 must always render identically (the recordings enforce it). Any change to page geometry or drawing creates a new drawing version; old versions are kept and used for payslips issued with them.

## Stack and design
React 18, Vite, TypeScript strict, Tailwind v4, Zod, lucide-react, Geist and Geist Mono (bundled). The look is in docs/DESIGN_SYSTEM.md. The payslip page itself is a picture of paper and does not follow the dark theme.

## Working agreements
- Build ONE phase at a time (phases are in docs/BRIEF.md). Stop after each phase with a short summary, what to test, and anything I must do myself.
- Ask before adding a package; list every new dependency and why.
- Safety net first: tests with fake data that record the exact layout model, the Excel cell values and styles, and the text read back from the generated PDF. Prove each recording can fail (change one value, see it fail, revert).
- Before every commit run: the tests, an encoding check (no mojibake, no changed non-ASCII characters), lint and typecheck, and the production build (0 requests to outside servers).
- Accessibility as scripts: 2px accent focus ring, contrast, reduced motion, names on every control, one shared keyboard helper for dialogs and menus (focus trap, Escape, focus returns to the opener).
- Usage: at most 3 screenshots per step, prefer scripted checks, keep replies short (results and decisions only).
- Findings that are not part of the task go in docs/KNOWN_ISSUES.md with evidence (fake data only). Do not fix them unasked.
- Never push or merge; I do that.
- Keep this file lean. Detail belongs in docs/BRIEF.md.

## Status
- [x] Phase 0 plan  - [x] Phase 1  - [x] Phase 2  - [x] Phase 3  - [x] Phase 4  - [ ] Phase 5  - [ ] Phase 6