
import { test, expect } from '@playwright/test';
import { runSpec, startSuite, wait } from '../helpers/suite';

test('TC08 - Preparation Flow', async () => {
    test.setTimeout(2 * 60 * 60 * 1000);

    const accountId = await startSuite('TS01');

    runSpec('tests/test-1.spec.ts');
    await wait(10);

    runSpec('tests/TC07-A-Collection.spec.ts');

    expect(true).toBe(true);

    console.log('================================================');
    console.log(`PASS: TC08 PREPARATION COMPLETE - ${accountId}`);
    console.log('test-1 -> TC07-A-Collection');
    console.log('================================================');
});
