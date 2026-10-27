import { test } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import { login, runNextBillingCycle, runCollectionDayByDay, payInvoices, waitForInvoiceClosed, withDay, weekday, isWeekend } from '../helpers';

// 790115 TC-21: collections suspension on a 21st that falls on a weekend (not moved to Monday),
// notice on the next day. Bills month by month, paying each invoice in full (R04) until the due
// month's 21st is a Saturday or Sunday, then runs the collection day by day as in TC-16.

test('790115 TC-21 - suspension on the 21st (weekend)', async ({ page, request }) => {
    test.setTimeout(60 * 60 * 1000);

    const accountId = ACCOUNT_ID;
    const dayName = (date: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(date)];

    await login(page);

    for (let cycle = 1; cycle <= 6; cycle++) {
        const bill = await runNextBillingCycle(page, accountId, `BILLING CYCLE ${cycle}`);
        const the21st = withDay(bill.dueDate, 21);

        console.log(`Invoice ${bill.invoiceId} due ${bill.dueDate} | the 21st (${the21st}) is a ${dayName(the21st)}`);

        if (isWeekend(the21st)) {
            const result = await runCollectionDayByDay(page, accountId, bill.dueDate);

            console.log('================================================');
            console.log('PASS: TC-21 COMPLETE');
            console.log(`Account: ${accountId} | Invoice ${bill.invoiceId} | Suspended ${result.suspensionDate} (${dayName(result.suspensionDate)}, ${result.suspendOrderId}) | Notice day processed ${result.noticeDate}`);
            console.log('================================================');
            return;
        }

        console.log(`Weekday 21st: paying invoice ${bill.invoiceId} in full and billing the next month`);
        await payInvoices(request, accountId, [{ invoiceId: bill.invoiceId, amount: bill.due }]);
        await waitForInvoiceClosed(page, accountId, bill.invoiceId);
    }

    throw new Error('No month with a weekend 21st reached within 6 billing cycles');
});
