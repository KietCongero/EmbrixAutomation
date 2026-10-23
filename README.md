# Embrix Playwright Regression Automation

Playwright + TypeScript automation for Embrix O2X regression testing of the **CoopeGuanacaste (CoopeG)** lifecycle: account creation, orders, provisioning, billing, payments and collections.

## Setup

```bash
git clone https://github.com/KietCongero/embrix-automation.git
cd embrix-automation
npm install
npx playwright install chromium
```

Then create `.env` (see [Credentials](#credentials-env)).

## Configuration

### Environments

All URLs, the database and the ONT are defined in one file: [`config/environments.ts`](config/environments.ts). Two environments exist side by side:

| | `demo` (default) | `ns` (NetSuite) |
| --- | --- | --- |
| UI | `core-ui.demo.embrix.org` | `core-ui.coopegsbx2.embrix.org` |
| API gateway | `crm-gateway.coopegsbx.embrix.org` | `crm-gateway.coopegsbx2.embrix.org` |
| GraphiQL | `transactional.coopeg.embrix.org` | `service-transactional.coopegsbx2.embrix.org` |
| DB host | `coopegsbx2-dev-db…rds.amazonaws.com` | `coopegsbx-dev-db…rds.amazonaws.com` |
| ONT / model | `ALCLB3A97FBA` / `G-240W-G` | `ALCLB3A97FBA` / `G-240W-G` |

Choose the environment with `TEST_ENV`. Set it in `.env` as the default, or override it for one run:

```bash
TEST_ENV=ns npx playwright test TS01
```

To change a URL, DB host or ONT, edit that environment's entry in `config/environments.ts`. No spec needs to change. An unknown `TEST_ENV` stops the run with the list of valid names.

### Credentials (`.env`)

`.env` holds credentials only and is gitignored. Never commit it.

```dotenv
TEST_ENV=demo

EMBRIX_USERNAME=
EMBRIX_PASSWORD=
EMBRIX_API_TOKEN=
OCI_USERNAME=
OCI_PASSWORD=
DB_USER=
DB_PASSWORD=

# Optional per-environment values: <ENV>_<KEY> wins over <KEY> for that environment
# NS_EMBRIX_USERNAME=
# NS_EMBRIX_PASSWORD=
# NS_EMBRIX_API_TOKEN=
# NS_DB_USER=
# NS_DB_PASSWORD=
```

If you put `DB_HOST` or `EMBRIX_API_URL` in `.env`, they are ignored. Those values come from `config/environments.ts`.

### Account IDs

You don't edit IDs between runs.

- **New accounts:** A suite, or any account-creation spec (`test-*.spec.ts`), takes the next free regression account. That is the highest `90xxxxx` account ID in the environment's DB, plus one. The order ID is `ORD<accountId>`.
- **Downstream specs:** The account just created is saved to `test-data/last-run/<TEST_ENV>.json` (gitignored). Downstream specs (TC05, TC07, TC10, …) read it automatically.
- **A specific account:** Set `ACCOUNT_ID` to use it in any spec. In a creation spec, it creates that ID instead of the next free one.

## Before every run: free the ONT (manual)

Each account-creation spec provisions the environment's ONT (`ALCLB3A97FBA`). **The ONT must be free before you start, and you check that yourself in the database. The code does not.** Run these read-only queries against the DB of the environment you are about to test:

```sql
-- Active subscription on the ONT? (enddate IS NULL = still in use;
-- ratingprovisioningid is the account it belongs to)
SELECT provisioningid, ratingprovisioningid, effectivedate, enddate
FROM core_engine.service_provision
WHERE provisioningid = 'ALCLB3A97FBA'
ORDER BY createddate DESC;

SELECT * FROM core_oms.order_service_provisions
WHERE provisioningid = 'ALCLB3A97FBA';

SELECT * FROM core_engine.service_unit
WHERE provisioningid = 'ALCLB3A97FBA';
```

If an active row exists, first confirm that the account has no pending order, since cancellation fails while one is pending. Then cancel that account's subscription:

```bash
CANCEL_ACCOUNT_ID=9000249 npx playwright test tests/cancel.spec.ts
```

Re-run the queries and confirm the ONT is free before starting the suite. Only cancel accounts created for testing.

## How to run

### Suites

Run a suite by name:

```bash
npx playwright test TS01
TEST_ENV=ns npx playwright test TS03
```

| Suite | Command | Steps |
| --- | --- | --- |
| TS01 Residential Account | `npx playwright test TS01` | test-1 → TC07-A-Collection |
| TS02 Change Plan | `npx playwright test TS02` | test-1 → TC09 billing / collection / payment / modify flow |
| TS03 Payment Extension | `npx playwright test TS03` | test-9 → TC05 → TC10-GracePeriod → TC10-B → TC08 |
| TS05 Withdrawal Order | `npx playwright test TS05` | test-13 → TC07-A-Collection ×2 → TC13-A-Viewing |
| TS08 PHC Account | `npx playwright test TS08` | test-16 → TC05 ×3 → TC16-Graph ×33 → TC05 (about 4 h) |

Each suite prints the environment it uses (UI, API, DB) and the account it allocated. It then runs each step in its own Playwright process against that same account. If a step fails, the suite stops there.

### Single steps

```bash
npx playwright test TC05                         # last account created in this TEST_ENV
ACCOUNT_ID=9000249 npx playwright test TC05      # a specific account
ACCOUNT_ID=9000300 npx playwright test test-1    # create a specific ID
```

If no account has been created yet in that `TEST_ENV` and `ACCOUNT_ID` is not set, downstream specs stop immediately with an error saying so.

### Results

```bash
npx playwright show-report
```

Record each result as Pass, Fail or Blocked in the regression matrix. Include the environment, account/order ID, ONT ID, and report or log evidence. Keep passwords, tokens and customer personal data out of the evidence.

## What to avoid

- **Don't run bare `npx playwright test`.** It runs every spec, including all suites and steps, against the same environment. Always name a suite or spec.
- **Don't run two suites at the same time,** even in different terminals. They share the ONT, the CCP time, and the job schedule.
- **Don't start a suite without checking the ONT** (see above). Account creation fails if the ONT is still active.
- **Don't run steps out of order.** Downstream specs depend on the billing, payment and collection state left by earlier ones. Prefer a full suite.
- **Don't hard-code URLs, DB hosts or credentials in specs.** Use `env` from `config/environments.ts`, and use relative paths with `page.goto('/…')` for the UI.
- **Don't cancel accounts you didn't create for testing.**

## Test cases needing review

These test cases don't fully match the expected results in the regression case yet:

| Test case | Spec(s) | Status |
| --- | --- | --- |
| TC-11 (credit note) | `test-11.spec.ts` | Doesn't match the regression case; needs checking |
| TC-12 (debit note) | `test-11.spec.ts` (TC-11 with a slight variant) | Doesn't match the regression case; needs checking |
| TC-15 (tax exemption) | `test-15.spec.ts` | May be fixed; needs retesting |
| TC-16 (PHC account) | `TS08.spec.ts`, `test-16.spec.ts`, `TC16-Graph.spec.ts` | Doesn't match the regression case; needs checking |

## CoopeG regression matrix

The source of truth for scenarios and expected results is **REGRESSION SUITE ENGLISH - COOPEGUANACASTE.csv**. This table maps suites to test cases; it doesn't mean every case is automated.

| Suite | Test cases | Scope |
| --- | --- | --- |
| **TS01 — Residential Account** | **TC-01–TC-08** | Account creation; installation invoice payment; successful provisioning; grace-period billing; recurring billing months 1 and 2; collection notification; full billing/collections/notification/suspension/reconnection flow |
| **TS02 — Change Plan** | **TC-09** | Collections, payments, billing, and plan change |
| **TS03 — Payment Extension and Arrangement** | **TC-10** | Residential grace-period extension |
| **TS04 — Credit Notes, Debit Notes** | **TC-11–TC-12** | Credit note and debit note flows |
| **TS05 — Withdrawal Order** | **TC-13** | Equipment retrieval / cancellation order |
| **TS06 — Intercompany Account** | **TC-14** | Intercompany residential account end-to-end |
| **TS07 — Exemptions** | **TC-15** | Residential tax-exemption validation |
| **TS08 — PHC Account** | **TC-16** | PHC account with required bundles |
| **TS09 — Customer Account Details** | **TC17** | Subscription/offer data: filter active offers |

TS04, TS06, TS07 and TS09 don't have suite runners yet. Their specs (`test-11` for TC-11 and TC-12, `test-14`/`TC14`, `test-15`, `TC17`) run individually. `TC17.spec.ts` (account 9000058) and `ccpdate.spec.ts` (account 9000040) target fixed accounts on purpose.

## Project layout

| Path | Purpose |
| --- | --- |
| `config/environments.ts` | Environment registry (URLs, DB, ONT) and credential lookup |
| `helpers/suite.ts` | Suite runner: allocates the account and runs each step spec |
| `helpers/accounts.ts` | Next-free account ID and the `last-run` record |
| `helpers/database.ts` | Postgres connection for the selected environment |
| `test-data/testIds.ts` | `ACCOUNT_ID` / `ORDER_ID` used by downstream specs |
| `test-data/tc*-account.json` | Account/order payload templates per test case |
| `tests/TS*.spec.ts` | Suite runners |
| `tests/test-*.spec.ts` | Account creation + provisioning per test case |
| `tests/TC*.spec.ts` | Downstream steps (billing, collection, grace period, …) |
