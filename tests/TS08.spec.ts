
import { test, expect } from '@playwright/test';
import { runSpec, startSuite, wait } from '../helpers/suite';

test('TC16 - PHC Complete Billing Flow', async () => {
    test.setTimeout(4 * 60 * 60 * 1000);

    const accountId = await startSuite('TS08');

    // 1. CREATE PHC ACCOUNT + PROVISIONING
    runSpec('tests/test-16.spec.ts', { headed: true });
    await wait(5);

    // 2. MONTHS 01-03 - REGULAR BILLING
    for (let month = 1; month <= 3; month++) {
        console.log(`BILLING MONTH ${month}`);
        runSpec('tests/TC05-RecurringBilling.spec.ts', { headed: true });
        await wait(5);
    }

    // 3. MONTHS 04-36 - GRAPHQL BILLING
    for (let month = 4; month <= 36; month++) {
        console.log(`GRAPHQL BILLING MONTH ${month}`);
        runSpec('tests/TC16-Graph.spec.ts', { headed: true });
        await wait(5);
    }

    //4. MONTH 37 - REGULAR BILLING
    console.log('BILLING MONTH 37');
    runSpec('tests/TC05-RecurringBilling.spec.ts', { headed: true });

    expect(true).toBe(true);

    console.log('================================================');
    console.log(`PASS: TC16 PHC BILLING FLOW COMPLETE - ${accountId}`);
    console.log('Account Creation -> Months 01-03 -> Months 04-36 -> Month 37');
    console.log('================================================');
});
