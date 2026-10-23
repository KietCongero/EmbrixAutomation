
import { test, expect } from '@playwright/test';
import { runSpec, startSuite, wait } from '../helpers/suite';

test('TS01 - Residential Account full flow', async () => {
    test.setTimeout(2 * 60 * 60 * 1000);

    const accountId = await startSuite('TS01');

    runSpec('tests/test-1.spec.ts');
    await wait(10);

    runSpec('tests/TC07-A-Collection.spec.ts');
    await wait(10);

    runSpec('tests/TC08.spec.ts');

    expect(true).toBe(true);

    console.log('================================================');
    console.log(`PASS: TS01 COMPLETE - ${accountId}`);
    console.log('test-1 -> TC07-A-Collection -> TC08');
    console.log('================================================');
});
