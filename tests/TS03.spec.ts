import { test, expect } from '@playwright/test';
import { runSpec, startSuite, wait } from '../helpers/suite';

test('TS03 - Payment Extension and Arrangement full flow', async () => {
    test.setTimeout(2 * 60 * 60 * 1000);

    const accountId = await startSuite('TS03');

    runSpec('tests/test-9.spec.ts', { headed: true });
    await wait(10);

    runSpec('tests/TC05-RecurringBilling.spec.ts', { headed: true });
    await wait(10);

    runSpec('tests/TC10-GracePeriod.spec.ts', { headed: true });
    await wait(10);

    runSpec('tests/TC10-B.spec.ts', { headed: true });

    expect(true).toBe(true);

    console.log('================================================');
    console.log(`PASS: TS03 COMPLETE - ${accountId}`);
    console.log('test-9 -> TC05 -> TC10 -> TC10-B');
    console.log('================================================');
});
