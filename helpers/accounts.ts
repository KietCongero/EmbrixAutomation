import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/environments';
import { queryDatabase } from './database';

// Regression accounts live in 9000000-9099999 (other 9xxxxxx accounts exist in the DB); orders are ORD<accountId>.
const FIRST_ACCOUNT_ID = 9000000;
const LAST_ACCOUNT_ID = 9099999;

const lastRunFile = path.join(__dirname, '..', 'test-data', 'last-run', `${env.name}.json`);

type LastRun = { accountId: string; orderId: string; createdAt: string };

export function readLastRun(): LastRun | null {
    if (!fs.existsSync(lastRunFile)) return null;
    return JSON.parse(fs.readFileSync(lastRunFile, 'utf8'));
}

export function saveLastRun(accountId: string) {
    const lastRun: LastRun = { accountId, orderId: `ORD${accountId}`, createdAt: new Date().toISOString() };

    fs.mkdirSync(path.dirname(lastRunFile), { recursive: true });
    fs.writeFileSync(lastRunFile, `${JSON.stringify(lastRun, null, 4)}\n`);
}

// Returns the account a creation spec should create. Uses ACCOUNT_ID when it is
// set (a suite already picked one, or you want a specific ID); otherwise takes the
// next ID after the highest test account in the DB. Either way it is recorded as
// the last run so later specs pick it up without editing any file.
export async function allocateTestAccount(): Promise<{ accountId: string; orderId: string }> {
    let accountId = process.env.ACCOUNT_ID;

    if (!accountId) {
        const [row] = await queryDatabase<{ max: string | null }>(
            `
      SELECT max(accountid::bigint) AS max
      FROM core_oms."order"
      WHERE accountid::text ~ '^90[0-9]{5}$'
    `
        );

        const next = Math.max(Number(row?.max ?? 0), FIRST_ACCOUNT_ID) + 1;

        if (next > LAST_ACCOUNT_ID) throw new Error(`No test account IDs left after ${row?.max}`);

        accountId = String(next);
        process.env.ACCOUNT_ID = accountId;
    }

    saveLastRun(accountId);

    console.log(`ACCOUNT ID ALLOCATED [${env.name}]: ${accountId}`);

    return { accountId, orderId: `ORD${accountId}` };
}
