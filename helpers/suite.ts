import { execFileSync } from 'node:child_process';
import { env } from '../config/environments';
import { allocateTestAccount } from './accounts';

// Runs one spec in its own Playwright process. Children inherit process.env,
// so they share the suite's TEST_ENV and ACCOUNT_ID.
export const runSpec = (file: string, options: { headed?: boolean } = {}) => {
    console.log('================================================');
    console.log(`RUNNING: ${file}`);
    console.log('================================================');

    const args = ['playwright', 'test', file, '--project=chromium', '--workers=1'];
    if (options.headed) args.push('--headed');

    execFileSync('npx', args, { stdio: 'inherit', env: process.env });

    console.log(`PASS: ${file}`);
};

export const wait = async (seconds: number) => {
    console.log(`Waiting ${seconds} seconds before next test...`);
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
};

// Call once at the top of a suite: picks the account ID every step will use.
// The ONT must already be free - checking that is a manual step (see README).
export const startSuite = async (suiteName: string) => {
    console.log('================================================');
    console.log(`START ${suiteName} [TEST_ENV=${env.name}]`);
    console.log(`UI: ${env.uiUrl}`);
    console.log(`API: ${env.apiUrl}`);
    console.log(`DB: ${env.db.host}/${env.db.database}`);
    console.log('================================================');

    const { accountId } = await allocateTestAccount();

    return accountId;
};
