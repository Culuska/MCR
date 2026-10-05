# MCR Construction ERP

Finance and project costing for Mogadishu Construction and Rehabilitation. Phase 1 is the finance core. Phase 2 adds workforce and payroll. Phase 3 adds equipment, vehicles and rentals. Phase 4 adds materials, stock and purchasing. Phase 5 adds subcontractors. Phase 6 adds site operations: tasks, daily reports and delays.

Next.js 16, TypeScript, PostgreSQL through Prisma 7.

## Run it

```bash
npm install
npx prisma dev --name mcr --detach   # local Postgres, no install needed
npx prisma migrate deploy
npx prisma db seed                   # sample projects, staff, attendance and one demo user per role
npm run dev                          # http://localhost:3000
```

`.env` needs `DATABASE_URL`, `SESSION_SECRET` (32+ characters) and `SEED_PASSWORD` (the password the demo users get). Do not commit `.env`.

Demo users, all `@mcr.example`: `admin`, `finance`, `accountant`, `pm`, `site`, `hr`, `store`, `viewer`.

Sample records are marked "(sample)". Delete them, or reset with `npx prisma migrate reset`, before real use. Change every demo password before this goes anywhere public.

## How the money works

- **Ledger.** Every transaction is a balanced journal entry (`src/lib/ledger.ts`). The code refuses an entry whose debits and credits differ.
- **Expenses** go Draft, Submitted, Approved, Paid. Approving books the cost against the project and creates a payable. Paying moves cash out and clears the payable. The person who entered an expense cannot approve it (Super Admin excepted).
- **Invoices** go Draft, Sent, Partial, Paid. Issuing books revenue and a receivable. A receipt moves cash in and clears the receivable.
- **Corrections** never edit history. Voiding posts reversing entries and keeps the original visible.
- **Calculations** live in `src/lib/finance.ts` only, so dashboards, reports and project pages cannot disagree.
- **Audit trail** records who did what, with before and after values for budget, contract and status changes.

## Workforce and payroll

- **Employees** are paid a daily wage or a monthly salary, with an optional overtime rate per hour.
- **Attendance** is recorded per day and per project (present, half day, absent, leave, plus overtime hours). Friday is the rest day. Days with no record are not paid.
- **Pay rules** are in `src/lib/payroll.ts` and checked by `npx tsx scripts/check-payroll.ts`. Daily staff earn wage x paid days. Monthly staff earn salary / 26 x paid days, capped at one salary, and paid leave counts. Gross = base + overtime + bonus. Net = gross - deductions - advance recovered.
- **Payroll runs** go Draft, Approved, Paid. The person who prepared a run cannot approve it (Super Admin excepted). One person cannot appear in two overlapping runs. Attendance inside an approved or paid run is locked.
- **Wage cost** is charged to the projects where each person worked, so project costing and profit include labour. Approving posts wages, deductions and advance recovery to the ledger. Paying clears Wages Payable from cash or bank.
- **Advances** are paid to employees from cash or bank and taken back through payroll. Balances are never typed in; they are worked out from advances paid less amounts recovered.

## Equipment, vehicles and rentals

- **One register** holds machines (hours are logged) and vehicles (kilometres are logged). Each has an owner type, plate number, next service date and insurance expiry.
- **Costs are ordinary expenses tagged with an asset.** Fuel, hire and repairs go through the same approval and ledger as everything else, so project costing already includes them. There is no second set of books. Choose the machine or vehicle on the expense form.
- **Daily log:** start and end meter readings, fuel, trips, driver and work done. Readings can only go up, which catches a mistyped hour meter or odometer. Work must be on the project the asset is assigned to that day.
- **Assignments:** an asset is on one project at a time. Overlapping assignments are refused. Release it to move it.
- **Rentals:** the total comes from the dates and rate (`src/lib/rentals.ts`, checked by `scripts/check-rentals.ts`). Part of a week or month counts as a full one. The deposit is held separately and is not a cost. "Raise expense" turns a hire into one draft expense, once. Overlapping hires of the same asset are refused.
- **Maintenance:** a service or repair with a cost raises a draft expense and can set the next service date.
- **Running costs:** cost per hour or kilometre and fuel per hour or kilometre for each asset, and fuel used by project.
- **Alerts:** service due or overdue, insurance expiring, hires ending, and approved payroll that has not been paid.

## Materials, stock and purchasing

- **Buying stock is not a cost.** A purchase order is received into the store, and the value goes into Inventory (an asset). It becomes a project cost only when the material is used on a project.
- **Purchase orders** go Draft, Ordered, Part received, Received. Quantities received cannot exceed what was ordered, and the same supplier invoice number cannot be booked twice.
- **Receiving a delivery** raises a draft supplier bill (category "Stock purchase") for finance to approve and pay like any other expense. The stock goes into Inventory straight away against "Goods received, not invoiced" (account 2200). Approving the bill moves that debt to Accounts Payable, so the ledger always matches the stock list.
- **Using stock** on a project posts Materials cost to that project and takes the value out of Inventory, at the weighted-average cost (`src/lib/stock.ts`, checked by `scripts/check-stock.ts`). You cannot use more than is in the store.
- **Corrections:** stock-count differences are written on or off at average cost. Corrections over $500 need finance staff. Opening stock (finance only) goes against owner's equity.
- **Reversals:** a delivery can be reversed by finance if none of its stock has been used. Issues can be voided, which puts the stock back at the cost it left at.
- **Checks:** `scripts/check-stock-ledger.ts` confirms each material's quantity equals the sum of its movements, the stock list matches Inventory in the ledger, and issues are counted in project costs.
- **Not covered yet:** one central store only (no transfers between sites), and no returns to supplier or price-variance handling.

## Subcontractors

- **A subcontractor is a supplier.** A subcontract ties one supplier to one project, with a scope, a contract value and a retention percentage (up to 20%). It starts as a draft; finance signs it off. The person who drafted it cannot sign it off (Super Admin excepted).
- **Payment certificates** state the total value of work done to date, not just this period. The system works out this certificate's gross (the new work), withholds retention, and shows the net payable (`src/lib/subcontract.ts`, checked by `scripts/check-subcontract.ts`). A certificate must be above the last one and cannot exceed the contract value. Only one draft at a time. The person who prepared a certificate cannot approve it.
- **Accounting:** approving a certificate posts the full gross to the project's subcontractor cost, credits Accounts Payable for the net, and credits Retention Payable (account 2320) for the retention. Paying settles the net from cash or bank.
- **Retention** is released after the subcontract is marked complete, for up to the amount held. A release can be voided.
- **Variations** add or take away contract value. They count once finance approves them, and cannot take the value below what is already certified.
- **Payment programme:** planned milestones with dates. The Overview warns when certified work falls behind what the programme expected by now.
- **Corrections:** only the latest certificate can be voided, so the running total stays right. Voiding reverses its ledger entries.
- **Checks:** `scripts/check-subcontract-ledger.ts` confirms every certificate adds up, retention held equals the ledger liability, payables reconcile, and project costs include certified work.
- **Not covered yet:** advance (mobilisation) payments, back-charges and penalties, and certificates paid in several instalments.

## Site operations

- **Tasks** belong to a project, with an assignee, dates, a priority, an estimated cost and a progress percentage. Status follows progress: any progress starts a task, 100% finishes it, progress on a blocked task puts it back in progress. Progress only goes up through reports and quick updates; lowering it needs the edit form and is recorded in the history (`src/lib/operations.ts`, checked by `scripts/check-operations.ts`).
- **Daily site reports** are one per active project per day. The report does not ask anyone to retype what the system already knows: workers on site come from attendance, machines and trucks from the equipment log, material from stock issues and spending from expenses. The author adds what was done, what is next, task progress and problems. A report cannot be edited once filed; a project manager other than its author reviews it. If a task update goes backwards, nothing in the report is saved.
- **Issues and delays** record what held work up, with working days lost. Open delays push the expected finish date out by the days lost.
- **Task cost:** an expense can be tagged to a task on the same project, so a task shows actual cost against its estimate.
- **Daily operations dashboard** (the Today tab): per project, workers, machines and trucks, material used, money spent, task counts, progress from tasks next to the progress set on the project, work completed that day, and open issues.
- **Alerts:** overdue tasks, blocked tasks, open delays, and a missing report for the previous working day. Friday is the rest day, so it is never expected.
- **Not covered yet:** editing a report after it is filed, and task dependencies.

## Attachments

Receipts, delivery notes, site photos and signed documents can be attached to expenses, invoices, daily site reports, purchase orders and subcontracts. Only JPEG, PNG, WebP and PDF files are accepted (the type is read from the file's own bytes, not its name), up to 8 MB each and 20 per record. Files are stored on disk under `STORAGE_DIR` (default `./storage`, never in the database or in `public/`) and are served only through `/api/files/[id]`, which checks the viewer's role for that record. Removing a file needs a reason and keeps the record; the file is hidden, not erased. Not supported: iPhone HEIC photos (set the camera to "Most compatible" or share as JPEG). Local disk storage must be replaced by cloud storage (`src/lib/storage.ts`) before hosting on a server with no persistent disk.

## PDF documents

**Reports** (the Reports page) can be previewed as a landscape PDF in a window before you download it, and also downloaded as CSV. The PDF and the CSV are built from the same rows. Reports over 5,000 rows show the first 5,000 in the PDF with a note; the CSV has everything. Phone browsers often cannot show a PDF inside the preview window, so use "Open in new tab" or "Download PDF" there.

Business documents:

Invoice, project statement, payslips (approved or paid payroll runs only, one page per employee) and subcontract payment certificate, from the buttons on each record or `/api/pdf/<invoice|project|payroll|certificate>/<id>`. Each kind needs read access to its own module. Figures come from the same calculations as the screens. The built-in PDF fonts cover Western European text only, so other scripts (for example Arabic) print as `?`.

## Putting it online

Needs a PostgreSQL database and a Node host (for example Vercel). Set these environment variables on the host: `DATABASE_URL` (the hosted database), `SESSION_SECRET` (a new long random value, never the local one), `STORAGE_DRIVER=db` (keeps uploaded files in the database, since hosts have no persistent disk). Then run `npx prisma migrate deploy` once against the hosted database and create the first admin with `npx prisma db seed` (set `SEED_PASSWORD` first; the seed also adds clearly marked sample records, so delete those or skip the seed and create users another way). Change the admin password after the first sign-in.

## Database connections

The local `prisma dev` database drops connections when more than two are open, so the app uses a pool of 2 against `localhost` and 10 elsewhere. Set `DB_POOL_MAX` to change it. The `prisma dev` database is meant for trying the app out. It can stop on its own; if it does, run `npx prisma dev start mcr` (leave it running in its own terminal), then restart `npm run dev`. For real use, point `DATABASE_URL` at a proper PostgreSQL server.

## Roles

Super Admin, Finance Manager, Accountant, Project Manager, Site Supervisor, HR, Storekeeper, Viewer. Access rules are in `src/lib/permissions.ts` and are checked again on the server for every action.

## Tests

```bash
npx tsx scripts/check-payroll.ts   # pay rules
npx tsx scripts/check-rentals.ts   # hire cost rules
npx tsx scripts/check-stock.ts     # stock cost rules
npx tsx scripts/check-subcontract.ts  # certificate and retention rules
npx tsx scripts/check-operations.ts   # task, progress and delay rules
npx tsx scripts/check-files.ts     # attachment type and size rules
npx tsx scripts/check-pdf.ts       # PDF engine
npx tsx scripts/check-ledger.ts    # debits equal credits, balance sheet balances
```

`scripts/test_attachments.py` and `scripts/test_pdfs.py` upload files and fetch the real PDFs over HTTP (they need `TOKEN_DIR` with session tokens). `scripts/test_assets.py`, `scripts/test_stock.py` and `scripts/test_subcontracts.py` and `scripts/test_operations.py` submit the equipment, stock, subcontract and site forms over HTTP and check every rule above. It needs `SESSION_SECRET` and a signed-in test session (`scripts/session-cookie.ts`), so run it only against a local copy. `scripts/cleanup-test-assets.ts` removes what the equipment test creates. `scripts/reset-materials-sample.ts` then `prisma/seed-materials.ts` restores clean sample stock after the stock test. `scripts/reset-subcontracts-sample.ts` then `prisma/seed-subcontracts.ts` does the same for subcontracts, and `scripts/reset-operations-sample.ts` then `prisma/seed-operations.ts` for site operations.

## Check the books

```bash
npx tsx scripts/check-ledger.ts
```

Prints total debits against credits, the balance sheet equation, and per-project costing.

## Not built yet

Still to come: purchase orders, subcontractor contracts, manual journal entries, Excel export (reports download as CSV), notifications by email, weekly pay periods for monthly staff, voiding an advance, editing or removing a usage entry or a hire once saved (cancel and re-enter), and a screen to correct attendance after a run is paid (void the run first).
