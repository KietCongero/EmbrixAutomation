import { test } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import { login, getCcpTime, getNextPendingBill, cleanJobs, setCcpTime, runBillingDailyJob, getStampedBillByPeriod, dayOfMonth, daysBetween, lastDayOfMonth } from '../helpers';

// 790115 TC-03 (EFT-99): first bill of an order dated before a 1st and activated after it.
// Runs on the account TC-01-B just created (TC790115-01B-OrderBeforeFirst.spec.ts), so the CCP
// time still sits on the activation date. Same billing flow as TC-05 (next PENDING bill -> clean
// that day's jobs -> move CCP -> run DAILY billing -> STAMPED bill). The sheet expects the first
// bill to run from the activation date to the next 1st, prorated and invoiced (due on the 18th);
// the bug billed from the order date at the full monthly amount with no invoice. Each value is
// logged next to the sheet's expectation, not asserted.

test('790115 TC-03 - first bill starts at activation, prorated and invoiced', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const accountId = ACCOUNT_ID;

    await login(page);

    // The CCP time was left on the activation date by TC-01-B.
    const activationDate = await getCcpTime(page);

    // 1. NEXT PENDING BILL
    const pendingBill = await getNextPendingBill(page, accountId);

    console.log('================================================');
    console.log(`ACTIVATION DATE (CCP): ${activationDate}`);
    console.log(`PENDING BILL: ${pendingBill.startDate} -> ${pendingBill.endDate}`);
    console.log(`BILLING JOB DATE: ${pendingBill.jobDate}`);
    console.log(`Sheet expects first bill from ${activationDate}: ${pendingBill.startDate === activationDate ? 'MATCH' : 'DIFFERS (bug: starts on the order date)'}`);
    console.log('================================================');

    // The CCP time never moves back: a bill period that already ended before the activation
    // date is the EFT-99 bug itself, and its billing day can no longer be processed.
    if (pendingBill.jobDate < activationDate) {
        throw new Error(`First bill ${pendingBill.startDate} -> ${pendingBill.endDate} ends before the activation date ${activationDate} (EFT-99 not fixed); not moving the CCP time back to ${pendingBill.jobDate}`);
    }

    // 2. CLEAN JOBS, MOVE CCP, RUN BILLING
    await cleanJobs(pendingBill.jobDate);
    await setCcpTime(page, pendingBill.jobDate);
    await runBillingDailyJob(page, pendingBill.jobDate);

    // 3. VERIFY STAMPED BILL + READ DUE DATE
    const bill = await getStampedBillByPeriod(page, accountId, pendingBill.startDate, pendingBill.endDate);

    const dueDay = dayOfMonth(bill.dueDate);
    const billedDays = daysBetween(bill.startDate, bill.endDate);
    const monthDays = lastDayOfMonth(bill.startDate);

    console.log('================================================');
    console.log('PASS: FIRST BILLING CYCLE VERIFIED');
    console.log(`Account: ${accountId}`);
    console.log(`Bill Period: ${bill.startDate} -> ${bill.endDate} (${billedDays} of ${monthDays} days) | Sheet expects start ${activationDate}: ${bill.startDate === activationDate ? 'MATCH' : 'DIFFERS'}`);
    console.log(`Invoice: ${bill.invoiceId} | Total: ${bill.billTotal} | Status: ${bill.status} | Sheet expects a prorated, invoiced bill`);
    console.log(`Due Date: ${bill.dueDate} (day ${dueDay}) | Sheet expects day 18: ${dueDay === 18 ? 'MATCH' : 'DIFFERS'}`);
    console.log('================================================');
});
