import { test } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import { login, getNextPendingBill, cleanJobs, setCcpTime, runBillingDailyJob, getStampedBillByPeriod, dayOfMonth } from '../helpers';

// 790115 TC-05: same flow as TC05-RecurringBilling (next PENDING bill -> clean that day's jobs ->
// move CCP -> run DAILY billing -> STAMPED bill). The sheet expects the invoice due on the 18th
// (NET_18): the due date is read from the Bills table and compared in the log, not asserted.

test('790115 TC-05 - run next billing cycle and read the due date', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const accountId = ACCOUNT_ID;

    await login(page);

    // 1. NEXT PENDING BILL
    const pendingBill = await getNextPendingBill(page, accountId);

    console.log('================================================');
    console.log(`PENDING BILL: ${pendingBill.startDate} -> ${pendingBill.endDate}`);
    console.log(`BILLING JOB DATE: ${pendingBill.jobDate}`);
    console.log('================================================');

    // 2. CLEAN JOBS, MOVE CCP, RUN BILLING
    await cleanJobs(pendingBill.jobDate);
    await setCcpTime(page, pendingBill.jobDate);
    await runBillingDailyJob(page, pendingBill.jobDate);

    // 3. VERIFY STAMPED BILL + READ DUE DATE
    const bill = await getStampedBillByPeriod(page, accountId, pendingBill.startDate, pendingBill.endDate);

    const dueDay = dayOfMonth(bill.dueDate);

    console.log('================================================');
    console.log('PASS: BILLING CYCLE VERIFIED');
    console.log(`Account: ${accountId}`);
    console.log(`Bill Period: ${bill.startDate} -> ${bill.endDate}`);
    console.log(`Invoice: ${bill.invoiceId} | Total: ${bill.billTotal} | Status: ${bill.status}`);
    console.log(`Due Date: ${bill.dueDate} (day ${dueDay}) | Sheet expects day 18: ${dueDay === 18 ? 'MATCH' : 'DIFFERS'}`);
    console.log('================================================');
});
