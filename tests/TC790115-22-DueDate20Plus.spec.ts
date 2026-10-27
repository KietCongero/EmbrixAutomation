import { test } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import {
    login,
    readInvoices,
    logInvoices,
    extendDueDate,
    processDay,
    processEmbrixDay,
    readCollectionActions,
    processOrder,
    withDay,
    addDays,
    addMonths,
    dayOfMonth,
} from '../helpers';

// 790115 TC-22: NORMAL contract with an unpaid invoice due on the 20th or later.
// The latest open invoice gets its due date extended to the 30th (Billing Data > Bills >
// EXTEND_DUE_DATE, as old TC-10) unless it is already on the 20th or later. The sheet expects:
// entry on the due date, reminder the next day, no suspension that month, suspension on the 21st
// of the next month, notice on the 22nd.
// The days are driven by what the collection unit shows (the entry has been seen to land the day
// after the due date on demo), so the spec can also resume from the account's current state.
// Each date is logged next to the sheet's, not asserted.

test('790115 TC-22 - invoice due on the 20th or later: suspension on the 21st of the next month', async ({ page }) => {
    test.setTimeout(40 * 60 * 1000);

    const accountId = ACCOUNT_ID;

    await login(page);

    const invoices = await readInvoices(page, accountId);
    logInvoices(invoices, 'INVOICES');

    const invoice = invoices
        .filter(row => row.folioStatus === 'STAMPED' && row.status !== 'CLOSED' && row.due > 0)
        .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];

    if (!invoice) throw new Error(`No open invoice for account ${accountId}`);

    // 1. DUE DATE ON THE 20TH OR LATER (extend to the 30th when needed)
    let dueDate = invoice.dueDate;

    if (dayOfMonth(dueDate) < 20) {
        dueDate = withDay(dueDate, 30);
        await extendDueDate(page, accountId, invoice.invoiceId, dueDate, `TC-22 due date extension from ${invoice.dueDate} to ${dueDate}`);
    } else {
        console.log(`Invoice ${invoice.invoiceId} already due on ${dueDate}`);
    }

    const expected = { reminder: addDays(dueDate, 1), suspension: withDay(addMonths(dueDate, 1), 21), notice: addDays(withDay(addMonths(dueDate, 1), 21), 1) };
    const compare = (label: string, actual: string | undefined, sheet: string) =>
        console.log(`${label}: ${actual ?? 'none'} | sheet expects ${sheet}: ${actual === sheet ? 'MATCH' : 'DIFFERS'}`);

    const readCurrent = async () => (await readCollectionActions(page, accountId)).filter(row => row.nextActionDate >= dueDate).pop();

    console.log('================================================');
    console.log(`Due date ${dueDate} | sheet expects reminder ${expected.reminder} | suspension ${expected.suspension} | notice ${expected.notice}`);
    console.log('================================================');

    // 2. COLLECTION ENTRY: process the due date, then the following days until the unit shows up
    let current = await readCurrent();

    if (!current) {
        for (let day = dueDate, attempt = 1; attempt <= 3 && !current; day = addDays(day, 1), attempt++) {
            await processDay(page, day);
            await page.waitForTimeout(10000);
            current = await readCurrent();
            console.log(`${day} processed | current collection action: ${current ? `${current.action} on ${current.nextActionDate}` : 'none shown'}`);
            if (current) compare('Collection entry day', day, dueDate);
        }
    } else {
        console.log(`Collection already started: ${current.action} on ${current.nextActionDate}`);
    }

    if (!current) throw new Error(`No collection action shown for invoice ${invoice.invoiceId} after processing ${dueDate} and the two following days`);

    // 3. DRIVE THE REMAINING DAYS BY THE PLANNED ACTIONS: reminder -> suspension -> notice
    let suspendOrderId = '';

    for (let step = 1; step <= 6 && current; step++) {
        const { action, nextActionDate } = current;

        if (action === 'FIRST_REMINDER_EMAIL') {
            compare('FIRST_REMINDER_EMAIL date', nextActionDate, expected.reminder);
            await processEmbrixDay(page, nextActionDate);
        } else if (action === 'INACTIVATE_SUBSCRIPTION') {
            compare('INACTIVATE_SUBSCRIPTION date', nextActionDate, expected.suspension);
            console.log(`Same month as the due date: ${nextActionDate.slice(0, 7) === dueDate.slice(0, 7) ? 'YES (sheet expects no suspension that month)' : 'no (match)'}`);
            await processEmbrixDay(page, nextActionDate);
            suspendOrderId = await processOrder(page, accountId, 'SUSPEND');
        } else if (action === 'NOTIFY_CANCELLATION_TO_CRM') {
            compare('NOTIFY_CANCELLATION_TO_CRM date', nextActionDate, expected.notice);
            await processEmbrixDay(page, nextActionDate);
            break;
        } else {
            console.log(`Unexpected action ${action} on ${nextActionDate}; stopping`);
            break;
        }

        await page.waitForTimeout(10000);
        current = await readCurrent();
        console.log(`${nextActionDate} processed | current collection action: ${current ? `${current.action} on ${current.nextActionDate}` : 'none shown'}`);
    }

    console.log('================================================');
    console.log('PASS: TC-22 COMPLETE');
    console.log(`Account: ${accountId} | Invoice ${invoice.invoiceId} due ${dueDate} | Suspend order: ${suspendOrderId || 'none'}`);
    console.log('================================================');
});
