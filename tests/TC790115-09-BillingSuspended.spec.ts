import { test } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import {
    login,
    verifyServiceStatus,
    getNextPendingBill,
    cleanJobs,
    setCcpTime,
    runBillingDailyJob,
    readInvoices,
    logInvoices,
    readCollectionActions,
    addDays,
} from '../helpers';

// 790115 TC-09 (and TC-18 / TC-19, same flow): billing while the services are SUSPENDED.
// Same as TC08 step 2 (runNextBillingCycle), then the collection unit's cancellation notice
// date is read as in TC08-A step 8.
// The sheet expects: cutoff month billed in full (TC-09 / TC-18) or no invoice for a month
// fully suspended (TC-19); notice at suspension + 10 (before EFT-102) or + 1 (EFT-102).
// Everything is read from the UI and reported; nothing is asserted beyond the billing run.

test('790115 TC-09 - billing while suspended and cancellation notice date', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const accountId = ACCOUNT_ID;

    await login(page);

    // 1. SERVICES MUST BE SUSPENDED
    await verifyServiceStatus(page, accountId, 'SUSPENDED');

    // 2. RUN NEXT BILLING CYCLE
    const invoicesBefore = await readInvoices(page, accountId);
    logInvoices(invoicesBefore, 'INVOICES BEFORE BILLING');

    const pendingBill = await getNextPendingBill(page, accountId);

    console.log('================================================');
    console.log(`PENDING BILL: ${pendingBill.startDate} -> ${pendingBill.endDate}`);
    console.log(`BILLING JOB DATE: ${pendingBill.jobDate}`);
    console.log('================================================');

    await cleanJobs(pendingBill.jobDate);
    await setCcpTime(page, pendingBill.jobDate);
    await runBillingDailyJob(page, pendingBill.jobDate);

    // 3. READ THE RESULT FOR THAT PERIOD (invoice or not)
    await page.waitForTimeout(10000);

    const invoicesAfter = await readInvoices(page, accountId);
    logInvoices(invoicesAfter, 'INVOICES AFTER BILLING');

    const generated = invoicesAfter.find(invoice => invoice.startDate === pendingBill.startDate && invoice.endDate === pendingBill.endDate);
    const previousStamped = invoicesBefore.filter(invoice => invoice.folioStatus === 'STAMPED').sort((a, b) => b.startDate.localeCompare(a.startDate))[0];

    console.log('================================================');
    if (generated && generated.folioStatus === 'STAMPED') {
        console.log(`Invoice generated for ${pendingBill.startDate} -> ${pendingBill.endDate}: ${generated.invoiceId} | Total ${generated.billTotal} | Due date ${generated.dueDate}`);
        if (previousStamped) {
            console.log(`Previous invoice ${previousStamped.invoiceId} total ${previousStamped.billTotal} | full-month amount: ${generated.billTotal === previousStamped.billTotal ? 'MATCH' : 'DIFFERS'}`);
        }
    } else {
        console.log(`No STAMPED invoice for ${pendingBill.startDate} -> ${pendingBill.endDate} (row: ${generated ? `${generated.status} / ${generated.folioStatus} / total ${generated.billTotal}` : 'not shown'})`);
    }
    console.log('================================================');

    // 4. CANCELLATION NOTICE DATE FROM THE COLLECTION UNIT
    const actions = await readCollectionActions(page, accountId);
    const suspension = actions.filter(row => row.action === 'INACTIVATE_SUBSCRIPTION').pop();
    const notice = actions.filter(row => row.action === 'NOTIFY_CANCELLATION_TO_CRM').pop();

    console.log('================================================');
    console.log(`INACTIVATE_SUBSCRIPTION: ${suspension ? suspension.nextActionDate : 'not found'}`);
    console.log(`NOTIFY_CANCELLATION_TO_CRM: ${notice ? notice.nextActionDate : 'not found'}`);
    if (suspension && notice) {
        console.log(`Sheet expects suspension + 10 (${addDays(suspension.nextActionDate, 10)}): ${notice.nextActionDate === addDays(suspension.nextActionDate, 10) ? 'MATCH' : 'DIFFERS'}`);
        console.log(`Sheet expects suspension + 1 with EFT-102 (${addDays(suspension.nextActionDate, 1)}): ${notice.nextActionDate === addDays(suspension.nextActionDate, 1) ? 'MATCH' : 'DIFFERS'}`);
    }
    console.log('================================================');

    console.log('================================================');
    console.log('PASS: BILLING WHILE SUSPENDED COMPLETE');
    console.log(`Account: ${accountId}`);
    console.log(`Bill Period: ${pendingBill.startDate} -> ${pendingBill.endDate}`);
    console.log('================================================');
});
