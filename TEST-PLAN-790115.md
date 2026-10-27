# Game plan: coding the 790115 test cases (TC-01 to TC-25)

> **Rules first:** `INSTRUCTIONS-790115.md` wins over anything here. Each spec copies the closest old spec step for step, adds no Q-asserts, DB checks or logging unless asked, never checks the ONT or cancels anything, and is run headed on demo before hand-over. The "What's missing" columns below list *possible* checks from the sheet, not work to do without asking.

Rough plan only. Source: `Test_cases_790115_EN.xlsx` (new) vs. the current specs, which were written for
`REGRESSION SUITE ENGLISH` (old). Ordered from "almost done" to "new work / blocked".

## What changed between the old suite and the new one

| Topic | Old suite (current code) | New 790115 cases | Impact on code |
| --- | --- | --- | --- |
| Account | API `processAccountAndOrder`, 90xxxxx IDs, fake provisioning via DB updates | Coopeweb contract 790115, real Nokia ONT `ALCLFCFF47D6 / G-1426G-A` | Decision needed (see Prep 3) |
| Package | PKG_INT_TV_VOIP_100MB / TVPREM_TELANAG / ... | `PKG_INT_NA_TV_VOIP_100MBPS` (Internet + IPTV + VOIP) | New JSON template |
| Due date | day 16 | day 18 (NET_18) | None, code reads the due date from the Bills table |
| Suspension | due + 5 (next Monday if weekend) | due + 5 until the ~Oct 19 release, then **the 21st** (even on a weekend) | Expected dates must be switchable |
| Cancellation notice | suspension + 10 | suspension + 10 → **suspension + 1** after the release | Same |
| Verification | UI tables | SQL queries Q01–Q18 + UI | Add a `helpers/queries.ts` with the Qs; `queryDatabase` already exists |
| Job schedules | delete + recreate freely (`cleanJobs`) | Process only; never delete/recreate after the previous day was processed; only delete with 0 pending jobs (Q09) | Add a pending-jobs guard to `cleanJobs` |
| Dates | computed from the next PENDING bill | fixed 2041–2042 dates | None, keep computing them |

## Prep (do once, before any TC)

1. **Pull the copy-pasted helpers into `helpers/`.** Note: `openServices` selects the Services link by `href`; old specs use an icon glyph in the link name that must be copied byte for byte if reused. _(done: see README › Shared helpers)_ Every spec re-declares `login`, `openAccount`, `setCcpTime`,
   `cleanJobs`, `fillJobDate`, `createAndRunDailyJob`, `runExistingDailyJob`, `getNextPendingBill`,
   `runBillingDailyJob`, `getCollectionInfo`, `payBill`, `processOrder`. The best copies to lift:
   - CCP time get/set: `cancel.spec.ts` (`runGraphql`, `getCcpTime`, `setCcpTime`)
   - Billing: `TC08.spec.ts` (`getNextPendingBill`, `runBillingDailyJob`, `getStampedBillByPeriod`, `runNextBillingCycle`)
   - Collection: `TC07-A-Collection.spec.ts` (`getCollectionInfo`, `getNextCancellationAction`, suspend order flow)
   - Payment: `TC08.spec.ts` (`readInvoices`, `payBill`) → make it `payInvoices(allocations[])` so R03 (two invoices) and R04 (partial amount) are one call
   - Orders: `TC08.spec.ts` (`getIncompleteOrder`, `completeOrderProvisioning`, `processOrder`, `executeManualOrder`)
   - Grace period UI: `TC08.spec.ts` (`applyGracePeriod`)
   - Due date extension UI: `TC10-GracePeriod.spec.ts` (step 7 block)
2. **`helpers/queries.ts`** _(done)_: Q01–Q18 from the Queries sheet as small functions over `queryDatabase` (account ID as parameter). Most new "expected results" are one SQL assert each.
3. **Decide fake vs. real provisioning.** _(decided: keep fake)_ Today `test-1.spec.ts` marks the provisioning steps COMPLETED/SKIPPED in the DB (no Nokia). The new TC-01 checks the real request to Nokia. Options: keep fake (fast, what we have, TC-01 "passes" but doesn't test Nokia) or add a `realProvisioning` mode that skips the DB updates, waits 5–8 min and polls Q03. The rest of the plan assumes fake, as today.
4. **Date helper** (`helpers/dates.ts`): `dueDate(bill) = 18th`, `reminder = due + 1`, `suspension = due + 5 → Monday` (old rule) or `21st` (EFT-102), `notice = suspension + 10` or `+ 1`. One flag `EFT102=true/false` picks the rule set, because the sandbox behaviour flips with the release.
5. **New template** `test-data/tc790115-account.json`: copy `tc13-account.json`, package `PKG_INT_NA_TV_VOIP_100MBPS`, services INTERNET + IPTV + VOIP. Add the lab ONT to `config/environments.ts` if real provisioning is chosen.

## The ordered list

Legend: **Have** = rough share of the test that is already written somewhere. **Size** = S (hours), M (a day or two), L (several days / unknowns).

### Tier A — basically done, wire existing code + add SQL asserts

| # | TC | What it checks | Existing code to reuse | What's missing | Have | Size |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | TC-05 | Invoices due on the 18th | `TC05-RecurringBilling.spec.ts` | **Spec written:** `TC790115-05-Billing.spec.ts` (logs due day vs 18) | 100% | done |
| 2 | TC-06 | Collection entry on due date | `TC07-A-Collection.spec.ts` steps 4–6 | **Spec written:** `TC790115-06-08-Collection.spec.ts` | 100% | done |
| 3 | TC-07 | First reminder; next action INACTIVATE_SUBSCRIPTION | `TC07-A-Collection.spec.ts` steps 7–8 | same spec (logs reminder and suspension dates vs sheet) | 100% | done |
| 4 | TC-08 | Suspension | `TC07-A-Collection.spec.ts` steps 9–14 | same spec | 100% | done |
| 5 | TC-10 | Pay open invoices while suspended → RESUME → ACTIVE | `TC08.spec.ts` step 4 | **Spec written:** `TC790115-10-PayResume.spec.ts` (one request, every open invoice) | 100% | done |
| 6 | TC-20 | Same as TC-10 after the notice | same | reuse `TC790115-10-PayResume.spec.ts` | 100% | done |
| 7 | TC-15 | One PO_VOIP charge only (known failing, EFT-97) | none | **Spec written:** `TC790115-15-Charges.spec.ts` (Q18 report only, no assert) | 100% | done |
| 8 | TC-09 | Billing while suspended; notice date | `TC08.spec.ts` step 2, `TC08-A` step 8 | **Spec written:** `TC790115-09-BillingSuspended.spec.ts` (logs total vs previous invoice, notice vs +10 / +1) | 100% | done |
| 9 | TC-18 | Same as TC-09, +11 rule | same | reuse `TC790115-09-BillingSuspended.spec.ts` | 100% | done |
| 10 | TC-19 | Month fully suspended not billed | same | reuse `TC790115-09-BillingSuspended.spec.ts` (reports no invoice instead of failing) | 100% | done |

### Tier B — mostly reuse, one or two new pieces each

| # | TC | What it checks | Existing code to reuse | What's missing | Have | Size |
| --- | --- | --- | --- | --- | --- | --- |
| 11 | TC-01 | Provision Internet + IPTV + VOIP from the UI; services ACTIVE | `test-11.spec.ts` (API create, order wizard, provisioning data, submit, wait ACTIVE) | **Done:** `tests/test-790115.spec.ts`, passed headed on demo 2026-10-26 (account 9000263) | 100% | done |
| 12 | TC-12 + TC-13 | Underpayment outside / within the 1 colón threshold | `TC08.spec.ts` `payBill` | **Spec written:** `TC790115-12-13-Threshold.spec.ts` (Transactions screen and Basic Settings not read) | 100% | done |
| 13 | TC-17 | Notice the day after the suspension | `TC13-A-Viewing.spec.ts` | **Spec written:** part of `TC790115-16-17-Suspension21st.spec.ts` | 100% | done |
| 14 | TC-02 | Negative: wizard rejects an ONT already registered on another order | `test-790115.spec.ts` wizard | **Spec written:** `TC790115-02-DuplicateOnt.spec.ts` | 100% | done |
| 15 | TC-11 | Reconnection month prorated | `TC05-RecurringBilling.spec.ts` | **Spec written:** `TC790115-11-Proration.spec.ts` (total-level; Invoice Details lines not read) | 100% | done |
| 16 | TC-16 | Suspension on the 21st (weekday), nothing on the 20th | `TC07-A-Collection.spec.ts` | **Spec written:** `TC790115-16-17-Suspension21st.spec.ts` (`runCollectionDayByDay` in helpers/collection.ts) | 100% | done |
| 17 | TC-21 | Suspension on a weekend 21st | TC-16 + `payBill` | **Spec written:** `TC790115-21-Suspension21stWeekend.spec.ts` | 100% | done |
| 18 | TC-22 | NORMAL invoice due on the 20th or later: entry + reminder, no suspension that month; suspension on the 21st of the next month, notice on the 22nd | `TC10-GracePeriod.spec.ts` (EXTEND_DUE_DATE UI + collection on the new due date) | Second account; new expectations (no suspension in that month); process the 21st/22nd of the next month | 55% | M |
| 19 | TC-04 | Identity document without accent → INVOICE_CHECK error (DIMEX); fix in UI; Reprocess → invoice created | `jobsrun.spec.ts` (waits for INVOICE_CHECK = ERROR); payload (`identityDocument`) | Template with `CEDULA DE IDENTIDAD` (no accent); Q10 jobs_error; **Account Data edit of the identity type (new UI)**; **Reprocess button (not automated anywhere)**; Q07 | 50% | M |

### Tier C — new work or blocked on the environment

| # | TC | What it checks | Existing code to reuse | What's missing | Have | Size |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | TC-03 | First bill unit starts at activation, not at the Coope order date (known failing, EFT-99) | Q07/Q08 (trivial) | Scenario needs a Coopeweb order with an effective date earlier than activation. API-created accounts don't have that. Automate as a **verify-only** step on a Coope contract, or skip | 30% | S (verify) / blocked (scenario) |
| 21 | TC-23 | Back-office grace: 0 day, 1 day given on the 20th, 5 days given on the 18th | `TC08.spec.ts` `applyGracePeriod` (GRACE_PERIOD_REQUESTED UI); collection engine | Three accounts (three ONT cycles, cancel between each); process the 18th→27th per account; **blocked**: engine commit not on sandbox, rule not confirmed by Coope | 40% | L |
| 22 | TC-14 | PDF total = Embrix balance; 911 / Red Cross in PDF = Tax Lines (known failing, EFT-63/97) | Bills table read (`readInvoices`) | PDF download + parse (no PDF lib in `package.json`; needs e.g. `pdf-parse`); Invoice Details › Tax Lines read (new UI) | 15% | L |
| 23 | TC-24 | ESPECIAL profile: suspension at due + 12, next business day on weekends, February case | Collection engine; date helper | Account with `collectionProfile` ESPECIAL (payload value unknown, today always `Normal`); profile set to +12 / SIGUIENTE_DÍA_HÁBIL; three scenarios incl. moving CCP to February; **blocked** (Huy / Coope) | 25% | L |
| 24 | TC-25 | Changing the profile (+14 → +12) does not move an already planned suspension | Collection engine | Change collection profile in the UI (not automated anywhere); ESPECIAL account; **blocked** (Huy) | 20% | L |

## Run log

**2026-10-27, demo, account 9000263** (created 2026-10-26 by TC-01; sandbox dates 2068). Every Tier A spec run headed, one at a time.

| Spec | Result | What the UI showed vs. the sheet |
| --- | --- | --- |
| TC790115-05-Billing | pass | First bill 2068-09-21 → 10-01 prorated, invoice 418789 total 8376.92, due 2068-10-18 (day 18: match) |
| TC790115-06-08-Collection | pass | Invoice 418791 (full month 25130.76) due 11-18; FIRST_REMINDER_EMAIL 11-19 (match); INACTIVATE_SUBSCRIPTION 11-21 (EFT-102 rule: match; due + 5 rule: differs). So demo already applies EFT-102. SUSPEND order ORD-40094, services SUSPENDED |
| TC790115-09-BillingSuspended | pass | Cutoff month billed in full: 418793 total 25130.76 = previous invoice (match); NOTIFY_CANCELLATION_TO_CRM 11-22 = suspension + 1 (EFT-102) |
| TC790115-10-PayResume | pass on 3rd run | 1st run: 3 invoices in one applyPayment → two SUCCESS, third FAILED with a Postgres deadlock inside Embrix (`balance_unit_balances`), and the multi-invoice response is `{ paymentDetails: [...] }`, not `{ status }`. Helper now reads both shapes and retries a failed allocation once. 2nd run: the failed run had left RESUME order ORD-40095 with a FAILED step; a second RESUME (ORD-40096) was created and "Submit order" acted on the first one. `processOrder` now completes every incomplete order of the type before submitting. 3rd run: ACTIVE. ORD-40096 is left at PROVISIONING_ERROR (duplicate, harmless) |
| TC790115-15-Charges | pass | One PO_VOIP, on the VOIP service; no duplicate (EFT-97 not reproduced on this package) |


**2026-10-27, demo, account 9000263, Tier B** (continued on the same account, dates 2069).

| Spec | Result | What the UI showed vs. the sheet |
| --- | --- | --- |
| TC790115-11-Proration | pass | Reconnection was on 2068-12-01 (day 1), so invoice 418796 is a full month (25130.76): correct for that date, proration not exercised. For a mid-month reconnection, pay on a later CCP date before resuming |
| TC790115-12-13-Threshold | pass | balance − 2.00 → ACTIVE with 2.00 due (match); then 1.50 → CLOSED, 0 due (match). The 0.50 adjustment in Transactions is not read |
| TC790115-16-17-Suspension21st | pass | Invoice 418798 due 02-18; 2069-02-21 is a Thursday. Suspension on 02-21 (match) and NOTIFY_CANCELLATION_TO_CRM planned for 02-22 (match). **Finding:** the collection entry happened on 02-19, the reminder on 02-20 (emails and jobs in the DB confirm it), one day later than in the Tier A run where the entry was on the due date 11-18. Same spec steps for the due day in both runs. Worth raising |
| TC790115-09 as TC-18 | pass | February cut off on the 21st (20 days + 11 ≥ 28) billed in full: 418799 = 25130.76 (option B: match) |
| TC790115-09 as TC-19 | pass | March fully suspended: no invoice for 2069-03-01 → 04-01 (match) |
| TC790115-02-DuplicateOnt | pass | Throwaway account 9000264 with its incomplete order; the wizard's Create was rejected with "duplicate key value: ProvisioningId already exist in service_provision" (core_oms.validate_order_service_provisions). No order created; last-run restored to 9000263 |
| TC790115-21-Suspension21stWeekend | pass | Paid May (418803) and June (418804) in full; July invoice 418807 due 07-18, 2069-07-21 is a Sunday. Entry 07-18 → reminder 07-19 → nothing new on 07-20 → suspended Sunday 07-21 (ORD-40100), notice planned 07-22. Every day matches the sheet, including the entry on the due date (so the February entry a day late is not systematic) |
| TC790115-10 as TC-20 | pass on 2nd run | Two invoices in one applyPayment (the sheet's R03): Embrix again reported a Postgres deadlock on one allocation, but that payment was applied (the retry answered "Invoice due already paid"). The helper now checks the Bills table after a FAILED allocation instead of retrying. RESUME processed, services ACTIVE |

Open point: paying two or three invoices in one request reports a deadlock on one allocation while applying it. Worth raising with the devs (the sheet's R03 pays two).

## Suggested suite shape

One new runner `TS790115.spec.ts` on one account, in this order (same contract, dates move forward, like the sheet says):

```
TC-01 (create + provision)
→ TC-05 billing ×3 (TC-03 / TC-04 verify-only hooks if wanted)
→ TC-06 → TC-07 → TC-08        (collection → reminder → suspension)
→ TC-09 (bill while suspended) → TC-10 (pay 2 → resume)
→ TC-11 (prorated month) → TC-12 → TC-13 (threshold) → TC-15 (Q18)
→ TC-16 → TC-17 → TC-18 → TC-19 → TC-20 → TC-21   (EFT-102 block, after the release)
```

Suite runner: `tests/TS790115.spec.ts` (TC-01 → TC-05 → TC-06/07/08 → TC-09 → TC-10 → TC-15).

Separate accounts: TC-22 (due date ≥ 20), TC-02 (needs the ONT held by another order), TC-23 (×3), TC-24 / TC-25 (ESPECIAL). TC-14 can run on the main account at the end once PDF parsing exists.

Rough total: Tier A ≈ 2–3 days, Tier B ≈ 1–2 weeks, Tier C depends on the blockers and the provisioning decision.
