import { test } from '@playwright/test';
import { runSpec, startSuite } from '../helpers/suite';

// 790115 TC-24 on its own ESPECIAL account: TC-01 creates and provisions it from
// test-data/tc790115-24-account.json (collectionProfile ESPECIAL), then TC-24 bills month by
// month and runs the PLAIN, WEEKEND and FEBRUARY collection scenarios (SCENARIOS=... to limit).
// The ONT must be free before starting (manual check, see README). Cancel the account with
// cancel.spec.ts before the next fresh account.

test('TS790115-TC24 - ESPECIAL collection profile', async () => {
    test.setTimeout(180 * 60 * 1000);

    process.env.ACCOUNT_TEMPLATE = 'test-data/tc790115-24-account.json';

    await startSuite('TS790115-TC24');

    runSpec('tests/test-790115.spec.ts', { headed: true });
    runSpec('tests/TC790115-24-Especial.spec.ts', { headed: true });
});
