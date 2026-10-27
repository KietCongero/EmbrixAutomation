# Game plan: coding the 790115 test cases (TC-01 to TC-25)

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

1. **Pull the copy-pasted helpers into `helpers/`.** _(done: see README › Shared helpers)_ Every spec re-declares `login`, `openAccount`, `setCcpTime`,
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
| 1 | TC-05 | Invoices due on the 18th | `TC05-RecurringBilling.spec.ts` (whole billing cycle); `getGeneratedBillDueDate` in `TC07-A-Collection.spec.ts` | `expect(dueDate.endsWith('-18'))` after each run; Q07 | 95% | S |
| 2 | TC-06 | Collection entry on due date: unit OPEN, next action FIRST_REMINDER_EMAIL next day, job queued for next day | `TC07-A-Collection.spec.ts` steps 4–6 (`cleanCollectionJobs`, `setCcpTime`, `createAndRunDailyJob`, `getCollectionInfo('FIRST_REMINDER_EMAIL')`) | Q11, Q12, Q13 asserts (same jobid in next day's schedule) | 90% | S |
| 3 | TC-07 | First reminder sent; next action INACTIVATE_SUBSCRIPTION at due + 5 (Monday if weekend) | `TC07-A-Collection.spec.ts` steps 7–8 (`runExistingDailyJob`, `getNextCancellationAction`) | Q14 email `FIRST_PAYMENT_REMINDER = SUCCESS`; date rule assert from Prep 4 | 90% | S |
| 4 | TC-08 | Suspension: SUSPEND order COMPLETED, subscription + services SUSPENDED, email | `TC07-A-Collection.spec.ts` steps 9–14 (`getSuspendOrder`, `completeSuspendProvisioning`, `submitSuspendOrder`, `verifySuspended`) | Q15, Q16, Q14 asserts; next action NOTIFY_CANCELLATION_TO_CRM date | 90% | S |
| 5 | TC-10 | Pay both open invoices while suspended → RESUME order → ACTIVE, collections CLOSED | `TC08.spec.ts` step 4 (`payBill` + `processOrder('RESUME')`, `verifyServiceStatus`) | `payInvoices` with two allocations (R03); Q07, Q11, Q15, Q16 | 85% | S |
| 6 | TC-20 | Same as TC-10 but after the cancellation notice was sent | Same as TC-10 | Only the precondition differs | 85% | S |
| 7 | TC-15 | One PO_VOIP charge only, linked to the VOIP service (known failing, EFT-97) | `queryDatabase` | New 20-line spec: Q18 → group by `priceofferid`, assert no duplicate on IPTV | 80% | S |
| 8 | TC-09 | Billing while suspended: cutoff-month invoice = full month (days used + 10 capped); notice at cutoff + 10 | `TC08.spec.ts` step 2 (`runNextBillingCycle` with service SUSPENDED); `TC13-A-Viewing.spec.ts` (`getLatestNotifyCancellationDate`) | Compare Bill Total (cells[7] in `readInvoices`) with the previous full invoice; notice date assert | 80% | S |
| 9 | TC-18 | Same as TC-09 with the "+11" rule (option B) | Same as TC-09 | Rule flag only | 80% | S |
| 10 | TC-19 | A month fully suspended is not billed: bill unit closed at ₡0, no invoice | `TC08.spec.ts` step 6 (billing while suspended) | A `verifyNoInvoice(period)` variant of `verifyBill` (today it demands STAMPED); Q08 total 0 | 75% | S |

### Tier B — mostly reuse, one or two new pieces each

| # | TC | What it checks | Existing code to reuse | What's missing | Have | Size |
| --- | --- | --- | --- | --- | --- | --- |
| 11 | TC-01 | Provision Internet + IPTV + VOIP from the UI; order COMPLETED; subscription + 3 services ACTIVE; billingdom 1 | `test-1.spec.ts` (API create, order wizard, provisioning data, submit, wait ACTIVE) | New template (Prep 5); Q02–Q05 asserts; **Nokia request check only if real provisioning (Prep 3)** | 70% (fake) / 35% (real) | S / L |
| 12 | TC-12 + TC-13 | Underpayment by ₡2 stays open; then ₡1.50 closes it with a ₡0.50 rounding adjustment | `TC08.spec.ts` `payBill` (reads Due from the Bills table) | Amount parameter (`due - 2`, then `1.50`); Q17; read Billing Data › Transactions for "Ajuste por redondeo en pago" (new, small UI read); threshold check in Basic Settings › Currency (read-only) | 70% | S–M |
| 13 | TC-17 | Notice to Coopeweb the day after suspension (EFT-102) | `TC13-A-Viewing.spec.ts` (reads the NOTIFY date); `runExistingDailyJob` | Process that day, Q10 + Q11 asserts; open the collection unit actions table (19 reminder · 21 inactivate · 22 notice) | 70% | S (after TC-16) |
| 14 | TC-02 | Negative: wizard rejects an ONT already registered on another order (duplicate key) | `test-1.spec.ts` steps 5–7 (wizard) | Run the wizard **without** the "rename old provisioningid" step 1; expect the error toast instead of "Create Order successfully!"; Q01 shows the other order. Needs a second account that already holds the ONT (the previous run's account works) | 65% | S–M |
| 15 | TC-11 | Reconnection month prorated from the reconnection date | `TC05-RecurringBilling.spec.ts` | Expected total = full month × days with service / days in month (±1 colón); line-level check needs reading Invoice Details (new) | 60% total-level | M |
| 16 | TC-16 | Suspension on the 21st (weekday): reminder on 19 plans INACTIVATE for the 21st; nothing on the 20th; suspended on the 21st; notice next day | `TC07-A-Collection.spec.ts` engine (collection create → reminder → suspend → verify) | Process day by day (18, 19, 20, 21) with `runExistingDailyJob` in a loop; assert INACTIVATE date = 21st; Q13 jobid match; pick a month whose 21st is a weekday (date helper) | 60% | M |
| 17 | TC-21 | Same as TC-16 on a weekend 21st (not moved to Monday); notice on Monday 22 | TC-16 + `payBill` | Pay the intermediate month's invoice; roll billing months until the 21st is a Sat/Sun | 55% | M |
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

Separate accounts: TC-22 (due date ≥ 20), TC-02 (needs the ONT held by another order), TC-23 (×3), TC-24 / TC-25 (ESPECIAL). TC-14 can run on the main account at the end once PDF parsing exists.

Rough total: Tier A ≈ 2–3 days, Tier B ≈ 1–2 weeks, Tier C depends on the blockers and the provisioning decision.
