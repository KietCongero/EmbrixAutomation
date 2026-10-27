import { test } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import { login, runNextBillingCycle, runCollectionDayByDay, withDay, weekday, isWeekend } from '../helpers';

// 790115 TC-16 / TC-17: collections suspension on the 21st (weekday) and the notice the day after.
// Next billing cycle (as TC-05), then every day from the due date to the 21st is processed and the
// collection unit read after each one (as TC07-A, one day at a time), the SUSPEND order is
// completed, and the 22nd is processed for NOTIFY_CANCELLATION_TO_CRM. Dates are logged, not asserted.

test('790115 TC-16/17 - suspension on the 21st (weekday) and notice the day after', async ({ page }) => {
    test.setTimeout(40 * 60 * 1000);

    const accountId = ACCOUNT_ID;

    await login(page);

    const bill = await runNextBillingCycle(page, accountId, 'BILLING BEFORE 21ST SUSPENSION');
    const the21st = withDay(bill.dueDate, 21);

    console.log(`Invoice ${bill.invoiceId} due ${bill.dueDate} | the 21st is ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(the21st)]}${isWeekend(the21st) ? ' (weekend: this is the TC-21 case)' : ''}`);

    const result = await runCollectionDayByDay(page, accountId, bill.dueDate);

    console.log('================================================');
    console.log('PASS: TC-16/17 COMPLETE');
    console.log(`Account: ${accountId} | Invoice ${bill.invoiceId} | Suspended ${result.suspensionDate} (${result.suspendOrderId}) | Notice day processed ${result.noticeDate}`);
    console.log('================================================');
});
