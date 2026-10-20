import { test } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test('TC13 - Withdrawal Order flow', async () => {
    test.setTimeout(90 * 60 * 1000);

    const wait = async () => {
        console.log('Waiting 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
    };

    const runTest = (file: string) => {
        console.log('================================================');
        console.log(`RUNNING: ${file}`);
        console.log('================================================');

        execFileSync('npx', ['playwright', 'test', file], {
            stdio: 'inherit',
            env: process.env,
        });

        console.log('================================================');
        console.log(`PASS: ${file}`);
        console.log('================================================');
    };

    runTest('tests/test-13.spec.ts');

    await wait();

    runTest('tests/TC07-A-Collection.spec.ts');

    await wait();

    runTest('tests/TC07-A-Collection.spec.ts');

    await wait();

    runTest('tests/TC13-A-View.spec.ts');

    console.log('================================================');
    console.log('TC13 FLOW COMPLETED');
    console.log('================================================');
});