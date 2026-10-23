import { env } from '../config/environments';
import { readLastRun } from '../helpers/accounts';

// No need to edit this file between runs.
// The account comes from ACCOUNT_ID when it is set (suites set it for every step),
// otherwise from the last account a creation spec made in this TEST_ENV
// (test-data/last-run/<env>.json). To target a specific account:
//
//   ACCOUNT_ID=9000249 npx playwright test TC05
const resolveAccountId = () => {
    const accountId = process.env.ACCOUNT_ID ?? readLastRun()?.accountId;

    if (!accountId) {
        throw new Error(
            `No account for TEST_ENV=${env.name}. Run an account-creation spec or suite first, or set ACCOUNT_ID.`
        );
    }

    return accountId;
};

export const ACCOUNT_ID = resolveAccountId();
export const ORDER_ID = `ORD${ACCOUNT_ID}`;
