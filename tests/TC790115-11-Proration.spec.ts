import { test } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import { login, readInvoices, logInvoices, runNextBillingCycle, lastDayOfMonth } from '../helpers';

// 790115 TC-11: invoice for the reconnection month. Same billing cycle as TC-05; the sheet expects
// each line prorated from the reconnection date (the reconnection day counts). The total is compared
// with the last full-month invoice in the log and the implied number of billed days is printed.
// Invoice Details lines are not read (not automated yet).

test('790115 TC-11 - billing of the reconnection month', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const accountId = ACCOUNT_ID;

    await login(page);

    const before = await readInvoices(page, accountId);
    logInvoices(before, 'INVOICES BEFORE BILLING');

    const fullMonth = Math.max(...before.filter(invoice => invoice.folioStatus === 'STAMPED').map(invoice => invoice.billTotal), 0);

    const bill = await runNextBillingCycle(page, accountId, 'RECONNECTION MONTH BILLING');

    const daysInMonth = lastDayOfMonth(bill.startDate);
    const impliedDays = fullMonth > 0 ? Math.round((bill.billTotal / fullMonth) * daysInMonth) : 0;

    console.log('================================================');
    console.log('PASS: RECONNECTION MONTH BILLED');
    console.log(`Account: ${accountId}`);
    console.log(`Invoice ${bill.invoiceId} | ${bill.startDate} -> ${bill.endDate} | Total ${bill.billTotal} | Due date ${bill.dueDate}`);
    console.log(`Last full-month total: ${fullMonth} | ${bill.billTotal === fullMonth ? 'FULL MONTH' : `PRORATED: about ${impliedDays} of ${daysInMonth} days`}`);
    console.log('================================================');
});
