import { test } from '@playwright/test';
import { runSpec, startSuite } from '../helpers/suite';
import { readLastRun } from '../helpers/accounts';

// 790115 TC-11 with a real mid-month reconnection, on the existing account (ACCOUNT_ID or the
// last-run account; no new account, the ONT stays where it is):
//   TC-06/07/08 bill + collection -> suspended on the 21st
//   -> TC-09 bills the cutoff month (full) -> TC-09 bills the fully suspended month (no invoice)
//   -> TC-10B pays and reconnects on the 15th -> TC-11 bills the reconnection month (prorated).

test('TS790115-TC11 - reconnection month prorated', async () => {
    test.setTimeout(90 * 60 * 1000);

    process.env.ACCOUNT_ID ??= readLastRun()?.accountId;

    await startSuite('TS790115-TC11');

    runSpec('tests/TC790115-06-08-Collection.spec.ts', { headed: true });
    runSpec('tests/TC790115-09-BillingSuspended.spec.ts', { headed: true });
    runSpec('tests/TC790115-09-BillingSuspended.spec.ts', { headed: true });
    runSpec('tests/TC790115-10B-ResumeMidMonth.spec.ts', { headed: true });
    runSpec('tests/TC790115-11-Proration.spec.ts', { headed: true });
});
