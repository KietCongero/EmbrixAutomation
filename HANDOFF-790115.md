# Handoff: 790115 test-case automation (as of 2026-10-27)

Repo `/Users/dom/Documents/Code/Playwright`, branch `test-790115` (not pushed). Commits: fda13be helpers + plan, 4466113 Tier A, acde414 Tier B, 39dcd0b TC-02, bf1668c TC-04 + TC-22.
Read first: `INSTRUCTIONS-790115.md` (owner's rules, win over everything), `TEST-PLAN-790115.md` (plan, status, run log, open points), README sections "790115 test cases" and "Shared helpers".

## Rules in force (from INSTRUCTIONS-790115.md)
- Copy the closest old spec step for step (test-11 for TC-01). Change only what the case forces.
- No Q01–Q18 asserts, extra DB checks or logging unless the owner asks. Sheet expectations are **logged next to UI values, never asserted** ("run and check, don't fail").
- ONT check is manual; never automate it; never cancel from a spec (only `CANCEL_ACCOUNT_ID=… npx playwright test tests/cancel.spec.ts` with the owner's go-ahead).
- CCP time only moves forward. Process job schedules, never Recreate; delete a schedule only with 0 pending jobs and only before the previous day is processed; clear demo leftovers once before a collection starts.
- No hard-coded environments; run every spec once **headed on demo** before hand-over and report the account and step reached. Never run two suites at once.
- Provisioning is faked in the DB (no Nokia): `UPDATE order_prov_sequence_list SET status='COMPLETED'` (test-11's form, not test-1's fixed list). Fake ONT `ALCLB3A97FBA / G-240W-G` from `config/environments.ts`.

## Environment state
- demo, sandbox CCP date now **2069-09-22**. Accounts: 9000263 (Tier A+B account, **cancelled/CLOSED**), 9000264 (TC-02 throwaway, incomplete unprovisioned order, harmless), **9000265** (TC-04/TC-22 account, SUSPENDED, invoice 418810 open due 2069-08-30, holds the fake ONT). `test-data/last-run/demo.json` → 9000265.
- Package `PKG_INT_NA_TV_VOIP_100MBPS`: INTERNET `BDL_INT_NA_100MBPS_TVE`, IPTV `TV_ESTANDAR` (its price offer id is literally `TV_ESTANDARTV ESTANDAR`), VOIP `BDL_VOIP`. Template `test-data/tc790115-account.json`; `tc790115-04-account.json` = same with `identityDocument: "CEDULA DE IDENTIDAD"` (no accent). Wizard INTERNET row label: `NA INTERNET 100 MBPS DUO TVE`.
- Demo already applies **EFT-102**: suspension on the 21st (weekday or weekend), notice = suspension + 1. Due dates are on the 18th (NET_18).

## Helpers (`helpers/`, import from `../helpers`)
ui (login, openAccount, openServices by href, verifyServiceStatus), ccp (runGraphql, getCcpTime, setCcpTime), jobs (cleanJobs with pending-jobs guard, createAndRunDailyJob, runExistingDailyJob, processDay = create-or-run, processEmbrixDay = must exist, runBillingDailyJob returns INVOICE_CHECK status, reprocessDailyJob with Process fallback), billing (readInvoices 26-col table, getNextPendingBill, getStampedBillByPeriod, runNextBillingCycle, extendDueDate), collection (readCollectionActions, getCollectionAction, applyGracePeriod, runCollectionDayByDay), payments (payInvoices handles single `{status}` and multi `{paymentDetails:[…]}` shapes, `strict:false` option; payAllOutstandingInvoices verifies CLOSED in the Bills table after a FAILED allocation; payInvoicePartially), orders (getIncompleteOrders by exact Type cell, completeOrderProvisioning, processOrder completes **every** incomplete order of the type before Submit, executeManualOrder), dates (addDays, withDay, eachDay, isWeekend, expectedCollectionDates legacy|eft102 via `COLLECTION_RULE`, default eft102), queries (Q01–Q18 functions, read-only except q06), accounts (allocateTestAccount, readLastRun, saveLastRun).

## Specs and how each run went (all headed on demo)
| Sheet case | Spec | Copied from | Run / measures taken |
| --- | --- | --- | --- |
| TC-01 | `tests/test-790115.spec.ts` | test-11 | Passed (9000263, 9000265). Owner fixed v1: test-1 provisioning list left STB/VOIP steps PENDING; DB ONT check removed; Q02–Q05 asserts removed; `openServices` strict-mode clash with "Billable Services" fixed by href. |
| TC-02 | `TC790115-02-DuplicateOnt.spec.ts` | TC-01 wizard, no stale-row rename | Passed: Create rejected "duplicate key value: ProvisioningId already exist in service_provision". Restores last-run file after creating the throwaway account. |
| TC-04 | `TC790115-04-IdentityDocument.spec.ts` | TC-01 steps + billing + Contact fix + Reprocess | Passed on 9000265: INVOICE_CHECK ERROR "receptor identificacion DIMEX debe contener 10 digitos"; fix on `/customers/<id>/contacts` (textbox after "Identity Document", button Modify); Reprocess button exists when a job is in ERROR; invoice 418810. |
| TC-05 | `TC790115-05-Billing.spec.ts` | TC05 | Passed: due day 18. Runs one cycle; run it as often as needed. |
| TC-06/07/08 | `TC790115-06-08-Collection.spec.ts` | TC07-A | Passed: entry 11-18, reminder 11-19, suspension 11-21, SUSPEND order via fake provisioning. |
| TC-09, TC-18, TC-19 | `TC790115-09-BillingSuspended.spec.ts` | TC08 step 2 | Passed ×3: cutoff month billed in full (Nov, Feb = option B); fully suspended March → no invoice (spec reports instead of failing). |
| TC-10, TC-20 | `TC790115-10-PayResume.spec.ts` | TC08 step 4, all open invoices in one request (R03) | Passed after fixes. Blockers: (1) Embrix reported a **Postgres deadlock** on one allocation of a 3- and a 2-invoice payment, yet the payment was applied → helper checks the Bills table instead of retrying; (2) multi-invoice response shape differs; (3) a failed run left a RESUME order with a FAILED step and "Submit order" acts on the first listed order → processOrder completes all orders of the type; (4) spec skips payment when nothing is outstanding (resumable). |
| TC-11 | `TC790115-11-Proration.spec.ts` | TC05 + total vs full month | Passed, but reconnection was on day 1 so the month was full; proration not exercised. To exercise it, move CCP mid-month before paying/resuming. |
| TC-12/13 | `TC790115-12-13-Threshold.spec.ts` | TC08 payBill with amounts | Passed: −2.00 stays ACTIVE with 2 due; 1.50 closes at 0. |
| TC-15 | `TC790115-15-Charges.spec.ts` | none (Q18 report) | Passed: no duplicate PO_VOIP on this package (EFT-97 not reproduced). |
| TC-16/17 | `TC790115-16-17-Suspension21st.spec.ts` | TC07-A day by day (`runCollectionDayByDay`) | Passed: suspension Thu 02-21, notice planned 02-22. Entry landed 02-19 (a day late). |
| TC-21 | `TC790115-21-Suspension21stWeekend.spec.ts` | same, pays months until a weekend 21st | Passed: paid May, June; July invoice suspended Sun 07-21, notice 07-22; entry on the due date. |
| TC-22 | `TC790115-22-DueDate20Plus.spec.ts` | TC10 EXTEND_DUE_DATE, then drives by the unit's planned actions | Passed on 2nd run: entry showed after 08-31 (reminder 09-01, differs), suspension Sat 09-21 (21st of the next month), notice 09-22. v1 assumed the sheet's day sequence and failed on a missing 09-21 schedule. |
| Suite | `TS790115.spec.ts` | runner | TC-01 → 05 → 06-08 → 09 → 10 → 15 (never run as a suite). |

## Findings to raise with the devs
1. applyPayment with 2–3 allocations reports `deadlock detected` on `balance_unit_balances` for one allocation while applying it (retry answers "Invoice due already paid"). The sheet's R03 is a 2-invoice request.
2. Collection entry lands on the due date (2068-11-18, 2069-07-18) or the day after (2069-02-18→19, 2069-08-30→31) with identical steps; reminder shifts with it, suspension stays on the 21st.
3. "Submit order" in In-complete Orders acts on the first listed order; a RESUME row's Reason text contains "SUSPEND" (locator trap).
4. RESUME order ORD-40096/40099 duplicates were created by payment retries (cancelled later with the account).

## Not done / needs a decision
- **Tier C**: TC-03 (needs a Coopeweb order with back-dated effective date; API accounts can't), TC-14 (PDF download + parsing, no lib installed; Tax Lines UI), TC-23 (3 NORMAL accounts, grace via `applyGracePeriod`; blocked: engine commit not on sandbox, rule unconfirmed), TC-24/25 (ESPECIAL collection profile account; payload value unknown; blocked on Huy/Coope).
- **Verification not automated (by rule, ask before adding)**: Customer Activity / Nokia request (TC-01), Q-asserts in general, Invoice Details lines and Tax Lines (TC-11, TC-14), Basic Settings threshold and Billing Data › Transactions adjustment (TC-12/13), Q13 jobid match (TC-06), email table Q14. The sheet's SQL is available as functions in `helpers/queries.ts` if the owner wants them.
- TC-05's "three billing runs" check is done by running the spec per cycle; TC-11 proration should be re-run with a mid-month reconnection.
- Next run on a fresh account needs the manual ONT check, then `CANCEL_ACCOUNT_ID=9000265 npx playwright test tests/cancel.spec.ts`.

## Commands
`npx playwright test tests/<spec> --project=chromium --workers=1 --headed` (one at a time); `ACCOUNT_ID=9000265 npx playwright test TC790115-09`; type-check `npx -y -p typescript@5.9.3 tsc --noEmit -p tsconfig.json`.
