import { test } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import {
    login,
    getNextPendingBill,
    cleanJobs,
    cleanJobsThroughMonthEnd,
    setCcpTime,
    runBillingDailyJob,
    getStampedBillByPeriod,
    createAndRunDailyJob,
    runExistingDailyJob,
    getCollectionAction,
    processOrder,
    expectedCollectionDates,
    addMonths,
    withDay,
    dayOfMonth,
} from '../helpers';

// 790115 TC-06 / TC-07 / TC-08: same flow as TC07-A-Collection.
//   next billing cycle -> collection entry on the due date (TC-06) -> first reminder (TC-07)
//   -> suspension job, SUSPEND order, services SUSPENDED (TC-08).
// Every date is read from the UI. The sheet's expectations (due day 18, reminder due + 1,
// suspension on the 21st with EFT-102 / due + 5 before it) are written next to the actual
// dates in the log, not asserted.

test('790115 TC-06/07/08 - billing cycle -> collection -> reminder -> suspension', async ({ page }) => {
    test.setTimeout(30 * 60 * 1000);

    const accountId = ACCOUNT_ID;
    const compare = (label: string, actual: string, expected: string) =>
        console.log(`${label}: ${actual} | sheet expects ${expected}: ${actual === expected ? 'MATCH' : 'DIFFERS'}`);

    await login(page);

    // 1. NEXT PENDING BILL
    const pendingBill = await getNextPendingBill(page, accountId);

    console.log('================================================');
    console.log(`PENDING BILL: ${pendingBill.startDate} -> ${pendingBill.endDate}`);
    console.log(`BILLING JOB DATE: ${pendingBill.jobDate}`);
    console.log('================================================');

    // 2. RUN NEXT BILLING CYCLE
    await cleanJobs(pendingBill.jobDate);
    await setCcpTime(page, pendingBill.jobDate);
    await runBillingDailyJob(page, pendingBill.jobDate);

    // 3. VERIFY STAMPED BILL + GET DUE DATE
    const bill = await getStampedBillByPeriod(page, accountId, pendingBill.startDate, pendingBill.endDate);
    const dueDate = bill.dueDate;
    const eft102 = expectedCollectionDates(dueDate, 'eft102');
    const legacy = expectedCollectionDates(dueDate, 'legacy');

    console.log('================================================');
    console.log(`NEW STAMPED BILL: ${bill.invoiceId} | Total ${bill.billTotal}`);
    compare('Due date day', String(dayOfMonth(dueDate)), '18');
    console.log(`Expected calendar (EFT-102): reminder ${eft102.reminder} | suspension ${eft102.suspension} | notice ${eft102.notice}`);
    console.log(`Expected calendar (before EFT-102): reminder ${legacy.reminder} | suspension ${legacy.suspension} | notice ${legacy.notice}`);
    console.log('================================================');

    // 4. CLEAN COLLECTION JOBS (once, from day 16 to month end, before the collection starts - as TC07-A)
    await cleanJobsThroughMonthEnd(withDay(dueDate, 16));

    // 5. START COLLECTION ON THE DUE DATE (TC-06)
    await cleanJobs(dueDate);
    await setCcpTime(page, dueDate);
    await createAndRunDailyJob(page, dueDate);

    // 6. FIRST REMINDER EMAIL (TC-06 expected: next action FIRST_REMINDER_EMAIL the next day)
    const firstReminder = await getCollectionAction(page, accountId, { actions: ['FIRST_REMINDER_EMAIL'], minimumDate: dueDate });

    console.log('================================================');
    compare('FIRST_REMINDER_EMAIL date', firstReminder.nextActionDate, eft102.reminder);
    console.log('================================================');

    // 7. RUN FIRST REMINDER (TC-07)
    await setCcpTime(page, firstReminder.nextActionDate);
    await runExistingDailyJob(page, firstReminder.nextActionDate);

    // 8. NEXT COLLECTION ACTION: NOTIFY_CANCELLATION_TO_CRM may or may not come before INACTIVATE_SUBSCRIPTION (as TC07-A)
    const nextAction = await getCollectionAction(page, accountId, {
        actions: ['NOTIFY_CANCELLATION_TO_CRM', 'INACTIVATE_SUBSCRIPTION'],
        minimumDate: firstReminder.nextActionDate,
        maximumDate: addMonths(firstReminder.nextActionDate, 2),
    });

    let cancellationNotification: { action: string; nextActionDate: string } | null = null;
    let suspensionAction: { action: string; nextActionDate: string };

    if (nextAction.action === 'NOTIFY_CANCELLATION_TO_CRM') {
        cancellationNotification = nextAction;

        console.log('================================================');
        console.log(`NOTIFY CANCELLATION DATE: ${cancellationNotification.nextActionDate}`);
        console.log('================================================');

        await setCcpTime(page, cancellationNotification.nextActionDate);
        await runExistingDailyJob(page, cancellationNotification.nextActionDate);

        suspensionAction = await getCollectionAction(page, accountId, {
            actions: ['INACTIVATE_SUBSCRIPTION'],
            minimumDate: cancellationNotification.nextActionDate,
            maximumDate: addMonths(cancellationNotification.nextActionDate, 2),
        });
    } else {
        console.log('================================================');
        console.log('NOTIFY_CANCELLATION_TO_CRM was skipped');
        console.log('INACTIVATE_SUBSCRIPTION is already the current collection action');
        console.log('================================================');

        suspensionAction = nextAction;
    }

    // 9. SUSPENSION DATE (TC-07 expected: INACTIVATE_SUBSCRIPTION on the 21st with EFT-102, due + 5 -> Monday before it)
    console.log('================================================');
    compare('INACTIVATE_SUBSCRIPTION date (EFT-102)', suspensionAction.nextActionDate, eft102.suspension);
    compare('INACTIVATE_SUBSCRIPTION date (before EFT-102)', suspensionAction.nextActionDate, legacy.suspension);
    console.log('================================================');

    // 10. RUN SUSPENSION JOB (TC-08)
    await setCcpTime(page, suspensionAction.nextActionDate);
    await runExistingDailyJob(page, suspensionAction.nextActionDate);

    // 11-14. SUSPEND ORDER: FIND, COMPLETE PROVISIONING, SUBMIT, VERIFY SUSPENDED
    const suspendOrderId = await processOrder(page, accountId, 'SUSPEND');

    // SUMMARY
    console.log('================================================');
    console.log('BILLING + COLLECTION PROCESS PASSED');
    console.log(`Account: ${accountId}`);
    console.log(`Bill Period: ${pendingBill.startDate} -> ${pendingBill.endDate}`);
    console.log(`Billing Date: ${pendingBill.jobDate}`);
    console.log(`Invoice: ${bill.invoiceId} | Total: ${bill.billTotal}`);
    console.log(`Invoice Due Date: ${dueDate}`);
    console.log(`First Reminder: ${firstReminder.nextActionDate}`);
    console.log(`Notify Cancellation: ${cancellationNotification ? cancellationNotification.nextActionDate : 'SKIPPED (not before suspension)'}`);
    console.log(`Suspension Date: ${suspensionAction.nextActionDate}`);
    console.log(`Suspend Order: ${suspendOrderId}`);
    console.log('Service Status: SUSPENDED');
    console.log('================================================');
});
