# Embrix Playwright Regression Automation

Playwright + TypeScript automation for Embrix O2X regression testing, including the **CoopeGuanacaste (CoopeG)** account, order, provisioning, billing, payment, and collections lifecycle.

This guide documents the working test approach and the CoopeG regression matrix. **Some scripts still hard-code UI URLs or database connections; verify the target environment before running anything that changes data.**

## Getting started

```bash
git clone https://github.com/KietCongero/embrix-automation.git
cd embrix-automation
npm install
```

The repository's `package.json` installs Playwright browsers during `postinstall`. If needed, run `npx playwright install` separately.

### Environment variables

Create a local `.env` file and fill in credentials from your authorized test environment. Never commit real credentials or tokens.

```dotenv
# Embrix UI login
EMBRIX_USERNAME=
EMBRIX_PASSWORD=

# OCI login, where required
OCI_USERNAME=
OCI_PASSWORD=

# Account/order creation API — CoopeG sandbox example
EMBRIX_API_URL=https://crm-gateway.coopegsbx.embrix.org/processAccountAndOrder
EMBRIX_API_TOKEN=

# Database connection (only for tests/helpers that need it)
DB_HOST=
DB_PORT=
DB_NAME=
DB_USER=
DB_PASSWORD=

# Required by the current tenant-aware Playwright configuration
TEST_ENV=coopeg-sandbox
```

**Important:** The current `playwright.config.ts` loads `.env` and `config/tenants.ts` uses `TEST_ENV` to resolve the environment. It deliberately refuses unknown tenants and disallowed test projects. `EMBRIX_BASE_URL`, if set, must match that tenant. The tenant registry configures CoopeG sandbox URLs, but **does not define a CoopeG database**. Do not guess a DB target or reuse credentials from another tenant.

The alternative API URL `https://crm-gateway.coopegsbx2.embrix.org/processAccountAndOrder` was mentioned in historical local configuration; do not switch to it without confirming which sandbox is intended.

## Before running: check the ONT

Have a dedicated ONT/provisioning ID available for the test (replace the example ID below). Check whether it is already associated with a service or previous provisioning order:

```sql
SELECT * FROM core_engine.service_provision sp
WHERE provisioningid = 'ALCLB3A97FBA'
ORDER BY enddate;

SELECT * FROM core_oms.order_service_provisions osp
WHERE provisioningid = 'ALCLB3A97FBA';

SELECT * FROM core_engine.service_unit su
WHERE provisioningid = 'ALCLB3A97FBA';
```

Review the returned records and their statuses. The goal is to confirm that the ONT is available for a new provisioning flow. These queries are **read-only**; they do not free an ONT.

If an active subscription is using it, `cancel.spec.ts` is available to cancel that subscription as part of authorized sandbox cleanup. **First confirm that the account has no pending order**; cancellation can fail while an order is pending. Recheck the records and verify cancellation/provisioning status before reusing the ONT. Do not cancel accounts you do not own or control for testing.

## Test execution workflow

1. **Select the test case or suite** in the CoopeG regression matrix.
2. **Confirm the environment** (`TEST_ENV=coopeg-sandbox`) and the intended API, UI, and DB target.
3. **Verify ONT availability** using the SQL above; clean up a previous test subscription only when appropriate.
4. **Set shared test IDs.** Existing standalone scripts import `ACCOUNT_ID`/`ORDER_ID` from `test-data/testIds.ts`. For the current manual workflow, update `RUN_NUMBER` in that file to generate the account/order IDs used by those scripts. Confirm the file's actual implementation before changing other values. A simpler ID-generation workflow is planned but not implemented here.
5. **Create the account/order.** Run the relevant account-creation spec (`test-1.spec.ts` or the test-specific `test-#.spec.ts`, where present). This prepares the account required for later cases and may include manual provisioning.
6. **Run billing and downstream steps** in the order required by the regression case. For example, `TC05-RecurringBilling.spec.ts` executes a recurring billing cycle and verifies a generated bill.
7. **Prefer a complete TS suite** when one exists, because later cases depend on earlier account, payment, provisioning, or billing state. Avoid running dependent cases out of order.
8. **Review results and artifacts**, then record the test case outcome in the regression matrix.

### Useful commands

The current GitHub `package.json` and Playwright configuration define these commands:

```bash
# CoopeG lifecycle regression project
npm run test:coopeg-lifecycle

# Run a selected spec within that configured project
npx playwright test --project=coopeg-lifecycle -g "test name"

# Other general commands
npm test
npm run test:headed
npm run test:ui
npm run typecheck
npm run report
```

For older standalone specs **only if their paths exist in your checkout and the selected project includes them**, a file-targeted command may look like:

```bash
npx playwright test tests/path/to/test-1.spec.ts --project=coopeg-lifecycle
```

Replace the path with the real repository location. The current `coopeg-lifecycle` project matches `tests/regression/coopeguanacaste/*.spec.ts`; it will not automatically execute standalone scripts stored elsewhere. The repository config runs with one worker and sequential execution because tests share account/billing state.

## CoopeG regression matrix

The source of truth for scenario definitions and expectations is **REGRESSION SUITE ENGLISH - COOPEGUANACASTE.csv**. The following is the suite-to-case mapping from that spreadsheet, **not a claim that every case is already automated**.

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

**Recommended approach:** Run complete suites such as TS01 when the implementation provides a suite-level runner. TS01 corresponds to **TC-01 through TC-08**, and those stages share state. The spreadsheet lists requirements; check the actual filenames and automation coverage in the current branch before assuming a one-to-one `.spec.ts` mapping.

### Standalone scripts reviewed

These filenames were supplied alongside the regression spreadsheet; their existence in the current GitHub default branch was **not verified**.

| Spec | Purpose |
| --- | --- |
| `test-1.spec.ts` | Create account/order; manually provision and activate |
| `cancel.spec.ts` | Cancel an existing active subscription |
| `TC05-RecurringBilling.spec.ts` | Run the next pending billing cycle and verify the bill |
| `bill.spec.ts` | View bill and apply a payment |
| `modify.spec.ts` | Modify an existing service/plan |
| `collection-job.spec.ts` | Start or advance collection jobs |
| `TC07-Collection.spec.ts`, `TC07-A-Collection.spec.ts` | Collection-related lifecycle paths |
| `TC08.spec.ts`, `TC08-A-Collection.spec.ts` | Longer billing/collection/reconnection lifecycle variants |
| `TC10 - Grace Period.spec.ts` | Grace-period test |
| `view.spec.ts` | View/record an existing workflow |

## Known limitations / work in progress

- **Hard-coded connections:** Some existing specs use literal UI URLs and/or database configuration. This is being tracked for cleanup. Check every target before execution; the central tenant registry does **not** guarantee older scripts use it consistently.
- **Manual IDs:** Shared `RUN_NUMBER` is currently changed manually in `test-data/testIds.ts` for the older standalone workflow. There is no documented automatic reservation/assignment of a safe ID here.
- **Shared mutable state:** Account creation, order provisioning, billing-cycle time changes, and collection jobs depend on test data created in earlier steps. Run sequentially; avoid parallel execution.
- **Database availability:** The current tenant registry does not define a DB name for CoopeG sandbox. Direct-DB steps require separately verified, authorized access.
- **Automation coverage:** The CSV defines TC-01 through TC17, but the existence and implementation status of every matching automated spec have not all been verified.

## Test results

Playwright is configured to output HTML reports (`playwright-report/`), JUnit results (`test-results/junit.xml`), and failure screenshots/traces/videos. To view the HTML report:

```bash
npm run report
```

Record each regression result as Pass, Fail, or Blocked, along with the environment, account/order ID, ONT ID, and relevant report/log evidence. Avoid placing passwords, API tokens, or customer personal information in test evidence.

---

*This README is an initial working guide based on the GitHub `main` branch configuration, the supplied CoopeG regression CSV, the provided standalone Playwright specs, and the documented manual ONT/account cleanup process.*
