import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

test('TS03 - Payment Extension and Arrangement full flow', async () => {
    test.setTimeout(2 * 60 * 60 * 1000);

    const run = (file: string) => {
        console.log('================================================');
        console.log(`RUNNING: ${file}`);
        console.log('================================================');

        execSync(`npx playwright test "${file}" --project=chromium --workers=1`, {
            stdio: 'inherit',
            env: process.env,
        });

        console.log(`PASS: ${file}`);
    };

    const wait = async (seconds: number) => {
        console.log(`Waiting ${seconds} seconds before next test...`);
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    };

    run('tests/test-9.spec.ts');
    await wait(10);

    run('tests/TC05-RecurringBilling.spec.ts');
    await wait(10);

    run('tests/TC10-GracePeriod.spec.ts');
    await wait(10);

    run('tests/TC10-B.spec.ts');

    expect(true).toBe(true);

    console.log('================================================');
    console.log('PASS: TS03 COMPLETE');
    console.log('test-9 -> TC05 -> TC10 -> TC10-B');
    console.log('================================================');
});