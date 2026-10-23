import { test } from '@playwright/test';
import { runSpec, startSuite, wait } from '../helpers/suite';

test('TC13 - Withdrawal Order flow', async () => {
    test.setTimeout(90 * 60 * 1000);

    const accountId = await startSuite('TS05');

    runSpec('tests/test-13.spec.ts');

    await wait(5);

    runSpec('tests/TC07-A-Collection.spec.ts');

    await wait(5);

    runSpec('tests/TC07-A-Collection.spec.ts');

    await wait(5);

    runSpec('tests/TC13-A-Viewing.spec.ts');

    console.log('================================================');
    console.log(`TC13 FLOW COMPLETED - ${accountId}`);
    console.log('================================================');
});
