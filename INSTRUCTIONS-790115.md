# Instructions: writing the 790115 test cases

Read this before you write or change any 790115 spec. These rules come from the test owner. Where they conflict with `TEST-PLAN-790115.md`, these rules win.

## Rules

1. **Base each spec on the closest old regression spec and copy its steps.** For TC-01, that's `tests/test-11.spec.ts`. It isn't `test-1.spec.ts`, even though the plan names test-1. Change only what the new case forces: the package template, bundle names, and dates. If a spec says it's "based on test-11", it must actually match test-11 step for step.
2. **No extra verification unless the owner asks.** Don't add Q01–Q18 SQL asserts, extra DB checks, or extra logging to a flow the old spec doesn't have. The "What's missing: Qxx asserts" column in the plan doesn't authorize them. Ask first.
3. **The ONT check is manual. Never automate it.**
   - Don't query the DB to find out who holds the ONT, and don't throw because it looks active.
   - The ONT may be in use on the other environment (`demo` vs `ns`). That environment's DB isn't visible from this one, so any DB check here can be wrong.
   - The one DB step you may keep is the old specs' rename of stale `core_oms.order_service_provisions` rows. It stops the wizard's duplicate-key error.
4. **Never cancel anything from a spec or suite.**
   - Cancelling is done only with `cancel.spec.ts` and an explicit `CANCEL_ACCOUNT_ID`.
   - Only cancel accounts that were created for testing.
5. **CCP time only ever moves forward.** Never set it back.
6. **Job schedules (rules from the 790115 sheet):**
   - Process jobs; don't recreate them.
   - Never delete or recreate a day's jobs after the previous day has been processed.
   - Only delete when there are 0 pending jobs (Q09).
   - On demo, clear stale jobs **once**, before the collection flow starts. Never clear them per step after the collection has started. Embrix schedules the next action's job itself.
7. **No hard-coded environments.**
   - Use `env` from `config/environments.ts`, and `page.goto('/…')` with relative paths.
   - Account IDs come from `allocateTestAccount()` or `ACCOUNT_ID`.
8. **Run what you write before you hand it over.**
   - Run it once, headed, on demo: `npx playwright test tests/<spec> --headed`.
   - Report the account ID and the step it reached.
   - Never run bare `npx playwright test`.
   - Never run two suites at once. They share the ONT, the CCP time and the job schedule.

## What the first version of `tests/test-790115.spec.ts` got wrong

The owner had to correct each of these items. Don't repeat them in the other test cases.

| # | What the first version did | Expected | Effect |
| --- | --- | --- | --- |
| 1 | Called itself "based on test-11", but used test-1's provisioning DB update. That update sets a fixed list to `COMPLETED` and three steps to `SKIPPED`, and leaves the rest alone. | Use test-11's update: `UPDATE core_oms.order_prov_sequence_list SET status = 'COMPLETED' WHERE id = $1`. That marks all steps. | The new package's STB and VOIP steps (`CREATE_STB_*`, `SESSION_LOGIN`, `CREATE_ORDER_SERVICE`, `USER_LOGIN`, `CREATE_CUSTOMER`, `CREATE_ACCOUNT`, `USER_LOGOUT`, `UPDATE_STATUS`) stayed `PENDING`. The order stayed at `PROVISIONING_ERROR`. |
| 2 | Step 1 queried the DB for the account holding the ONT and failed if it was active. | No automated ONT check (rule 3). Keep only the stale-row rename. | Gives false results when the ONT is held on the other environment. Goes against the owner's manual check. |
| 3 | Added a step 7 with Q02–Q05 asserts: order `COMPLETED`, no failed steps, ACTIVE subscription, INTERNET/IPTV/VOIP `ACTIVE` in `service_unit`, `billingdom = 1`. | End where test-11 ends: services `ACTIVE` in the UI. | The run failed on the order-status assert, even though the flow worked. |
| 4 | Logged every Q03 provisioning step and printed a WARNING for steps still open. | No extra logging (rule 2). | Noise, not in the old spec. |
| 5 | Found the INTERNET row with an XPath (`following::table[1]`) and took the first row with a View button. | Do it as test-11 does: click the `Service Type: INTERNET` heading, then filter rows by the bundle cell. For this package the bundle is `NA INTERNET 100 MBPS DUO TVE`, exact match. | Worked, but didn't match the old spec, and would silently pick the wrong row if the layout changed. |
| 6 | The shared helper `openServices` (`helpers/ui.ts`) used `getByRole('link', { name: ' Services' })` without the icon glyph the old specs have in front of "Services". | Copy locators byte for byte. If the name includes an icon glyph, select by `href` instead (now `a[href="/customers/<id>/services"]`). | Strict mode violation: the link name also matched "Billable Services". The spec failed at step 3. |
| 7 | Was handed over without ever being run. | Rule 8. | Problems 1, 3 and 6 were only found at run time. |

## Reference: the passing TC-01

`tests/test-790115.spec.ts` passed headed on demo on 2026-10-26 (account 9000263). Its steps:

1. Rename stale order rows on the ONT.
2. Create the account and incomplete order through the API.
3. Log in and check the incomplete order is shown in Services.
4. In the order wizard: reference order, then the INTERNET bundle row, View, +Add, then the ONT and model. Create.
5. test-11's DB updates for provisioning.
6. Submit the order and wait for `ACTIVE`.

Use it as the model for how much a 790115 spec should do.
