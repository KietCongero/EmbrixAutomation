
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

test('TC16 - PHC Complete Billing Flow', async () => {
    test.setTimeout(4 * 60 * 60 * 1000);

    const run = (file: string) => {
        console.log('================================================');
        console.log(`RUNNING: ${file}`);
        console.log('================================================');

        execSync(`npx playwright test "${file}" --project=chromium --workers=1 --headed`, {
            stdio: 'inherit',
            env: process.env,
        });

        console.log(`PASS: ${file}`);
    };

    const wait = async (seconds: number) => {
        console.log(`Waiting ${seconds} seconds before next test...`);
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    };

    // 1. CREATE PHC ACCOUNT + PROVISIONING
    run('tests/test-16.spec.ts');
    await wait(5);

    // 2. MONTHS 01-03 - REGULAR BILLING
    for (let month = 1; month <= 3; month++) {
        console.log(`BILLING MONTH ${month}`);
        run('tests/TC05-RecurringBilling.spec.ts');
        await wait(5);
    }

    // 3. MONTHS 04-36 - GRAPHQL BILLING
    for (let month = 4; month <= 36; month++) {
        console.log(`GRAPHQL BILLING MONTH ${month}`);
        run('tests/TC16-Graph.spec.ts');
        await wait(5);
    }

    //4. MONTH 37 - REGULAR BILLING
    console.log('BILLING MONTH 37');
    run('tests/TC05-RecurringBilling.spec.ts');

    expect(true).toBe(true);

    console.log('================================================');
    console.log('PASS: TC16 PHC BILLING FLOW COMPLETE');
    console.log('Account Creation -> Months 01-03 -> Months 04-36 -> Month 37');
    console.log('================================================');
});
