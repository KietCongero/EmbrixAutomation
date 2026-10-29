import { test } from '@playwright/test';
import { runSpec, startSuite } from '../helpers/suite';

// 790115 TC-03 (EFT-99) on its own account: TC-01-B creates and provisions it with the order
// dated before a 1st and the activation after it, then TC-03 runs the first billing cycle.
// The ONT must be free before starting (manual check, see README). Cancel the account with
// cancel.spec.ts before the next fresh account.

test('TS790115-TC03 - first bill at activation', async () => {
    test.setTimeout(45 * 60 * 1000);

    await startSuite('TS790115-TC03');

    runSpec('tests/TC790115-01B-OrderBeforeFirst.spec.ts', { headed: true });
    runSpec('tests/TC790115-03-FirstBillAtActivation.spec.ts', { headed: true });
});
