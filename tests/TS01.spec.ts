
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

test('TC08 - Preparation Flow', async () => {
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

    run('tests/cancel.spec.ts');
    await wait(10);

    run('tests/test-1.spec.ts');
    await wait(10);

    run('tests/TC07-A-Collection.spec.ts');

    expect(true).toBe(true);

    console.log('================================================');
    console.log('PASS: TC08 PREPARATION COMPLETE');
    console.log('cancel -> test-1 -> TC07-A-Collection');
    console.log('================================================');
});
