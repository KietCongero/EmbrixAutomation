import { test } from '@playwright/test';
import { runSpec, startSuite } from '../helpers/suite';

// 790115 Tier A on one account (same contract, dates move forward):
//   TC-01 create + provision -> TC-05 first billing -> TC-06/07/08 billing + collection + suspension
//   -> TC-09 billing while suspended -> TC-10 pay + reconnect -> TC-15 charges report.
// The ONT must be free before starting (manual check, see README).

test('TS790115 - Tier A flow', async () => {
    test.setTimeout(90 * 60 * 1000);

    await startSuite('TS790115');

    runSpec('tests/test-790115.spec.ts', { headed: true });
    runSpec('tests/TC790115-05-Billing.spec.ts', { headed: true });
    runSpec('tests/TC790115-06-08-Collection.spec.ts', { headed: true });
    runSpec('tests/TC790115-09-BillingSuspended.spec.ts', { headed: true });
    runSpec('tests/TC790115-10-PayResume.spec.ts', { headed: true });
    runSpec('tests/TC790115-15-Charges.spec.ts');
});
