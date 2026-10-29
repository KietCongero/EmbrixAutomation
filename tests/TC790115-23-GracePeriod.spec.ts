import { test } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import {
    login,
    verifyServiceStatus,
    getOutstandingInvoices,
    runNextBillingCycle,
    cleanJobsThroughMonthEnd,
    processDay,
    getCcpTime,
    setCcpTime,
    readCollectionUnit,
    applyGracePeriod,
    processOrder,
    payAllOutstandingInvoices,
    q11CollectionUnits,
    q15SubscriptionAndServices,
    q16NonNewOrders,
    withDay,
    addDays,
    eachDay,
    dayOfMonth,
    isWeekend,
} from '../helpers';

// 790115 TC-23 (EFT-102): back-office grace period on a NORMAL contract. The sheet uses one
// contract per scenario; this runs the three scenarios one after the other on one account
// (suspend -> pay -> RESUME -> next bill, as TC-10 / TC-21), so one ONT is enough.
// Grace is given from the Collections screen as TC08 step 13 does (GRACE_PERIOD_REQUESTED), on
// the unit of the scenario's invoice (units of paid invoices stay on the page as CLOSED).
// The sheet expects "the 21st + days granted" (not confirmed by Coope; engine commit 63647147b
// may not be on the sandbox): 0 days -> 21st, 1 day given on the 20th -> 22nd, 5 days given on
// the 18th -> reminder 24th and suspension 26th; a weekend date is kept; notice the day after.
// Dates are driven by what the collection unit plans and logged next to the sheet's, not asserted.
// Q11 / Q15 / Q16 are printed after each suspension day (sheet step 4).

type Scenario = {
    name: string;
    graceDays: number;
    graceDay: number; // day of month the grace is given
    lastDay: number; // last day of month to process
    expectedReminder: number;
    expectedSuspension: number;
};

const SCENARIOS: Scenario[] = [
    { name: 'C - 5-day grace given on the 18th', graceDays: 5, graceDay: 18, lastDay: 27, expectedReminder: 24, expectedSuspension: 26 },
    { name: 'B - 1-day grace given on the 20th', graceDays: 1, graceDay: 20, lastDay: 23, expectedReminder: 19, expectedSuspension: 22 },
    { name: 'A - 0-day grace given on the 18th', graceDays: 0, graceDay: 18, lastDay: 22, expectedReminder: 19, expectedSuspension: 21 },
];

const dayName = (date: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${date}T00:00:00Z`).getUTCDay()];

test('790115 TC-23 - back-office grace: 0 days, 1 day on the 20th, 5 days on the 18th', async ({ page, request }) => {
    test.setTimeout(120 * 60 * 1000);

    const accountId = ACCOUNT_ID;

    await login(page);

    const results: { scenario: string; dueDate: string; reminder: string; suspension: string; notice: string; suspendOrderId: string }[] = [];

    // SCENARIOS=B,A reruns a subset (a scenario that was interrupted resumes from the CCP day)
    const wanted = process.env.SCENARIOS?.split(',').map(s => s.trim().toUpperCase());

    for (const scenario of SCENARIOS.filter(s => !wanted || wanted.includes(s.name[0]))) {
        console.log('================================================');
        console.log(`SCENARIO ${scenario.name}`);
        console.log('================================================');

        await verifyServiceStatus(page, accountId, 'ACTIVE');

        // 1. AN UNPAID INVOICE DUE ON THE 18TH (the open one, else bill the next month)
        const outstanding = await getOutstandingInvoices(page, accountId);
        const bill = outstanding.length > 0 ? outstanding[outstanding.length - 1] : await runNextBillingCycle(page, accountId, `BILLING FOR ${scenario.name}`);
        const dueDate = bill.dueDate;

        console.log(`Invoice ${bill.invoiceId} due ${dueDate} (day ${dayOfMonth(dueDate)}) | EFT-102 suspension day ${withDay(dueDate, 21)}`);

        // The CCP time only moves forward: an interrupted scenario resumes from the day the CCP is on.
        const ccpTime = await getCcpTime(page);
        const firstDay = ccpTime > dueDate ? ccpTime : dueDate;

        if (firstDay !== dueDate) console.log(`Resuming: days before ${firstDay} were already processed`);

        // Once, before the collection starts (demo leftovers only); never once it has started
        if (ccpTime < dueDate) await cleanJobsThroughMonthEnd(withDay(dueDate, 16));

        // 2. PROCESS THE DAYS; GIVE THE GRACE ON ITS DAY
        const graceBeforeJob = scenario.graceDay !== dayOfMonth(dueDate); // B: on the 20th, before that day's job
        let graceGiven = false;
        let reminder = '';
        let suspension = '';
        let notice = '';
        let suspendOrderId = '';

        const unit = () => readCollectionUnit(page, accountId, bill.invoiceId);

        const giveGrace = async (day: string) => {
            const before = await unit();

            if (!before) {
                console.log(`${day}: no collection unit for invoice ${bill.invoiceId} yet (entry not landed); grace will be given the next day`);
                return;
            }

            await applyGracePeriod(page, accountId, bill.invoiceId, scenario.graceDays);
            graceGiven = true;

            const after = await unit();
            console.log(`${day}: unit planned ${before.action} on ${before.nextActionDate}; after the ${scenario.graceDays}-day grace it plans ${after?.action ?? '-'} on ${after?.nextActionDate ?? '-'}`);
        };

        for (const day of eachDay(firstDay, withDay(dueDate, scenario.lastDay))) {
            if (graceBeforeJob && !graceGiven && dayOfMonth(day) >= scenario.graceDay) {
                await setCcpTime(page, day);
                await giveGrace(day);
            }

            const planned = await unit();
            const suspendsToday = planned?.action === 'INACTIVATE_SUBSCRIPTION' && planned.nextActionDate === day;

            await processDay(page, day);

            if (!graceBeforeJob && !graceGiven && dayOfMonth(day) >= scenario.graceDay) await giveGrace(day);

            const current = await unit();
            console.log(`${day} (${dayName(day)}) processed | unit ${current ? `${current.status}: ${current.action || 'no next action'} ${current.nextActionDate}` : 'not shown'}`);

            if (planned?.action === 'FIRST_REMINDER_EMAIL') reminder = planned.nextActionDate;
            if (current?.action === 'FIRST_REMINDER_EMAIL') reminder = current.nextActionDate;
            // Entry and reminder can run in the same day's job; the unit then shows the reminder only as its last action.
            if (!reminder && current?.action === 'INACTIVATE_SUBSCRIPTION' && current.lastActionDate) reminder = current.lastActionDate;

            if (suspendsToday) {
                suspendOrderId = await processOrder(page, accountId, 'SUSPEND');
                suspension = day;

                const afterSuspension = await unit();
                notice = afterSuspension?.action === 'NOTIFY_CANCELLATION_TO_CRM' ? afterSuspension.nextActionDate : '';

                console.log(`Q11 collection units after the suspension day ${day}:`);
                console.table(await q11CollectionUnits(accountId));
                console.log('Q15 subscription and services:');
                console.log(JSON.stringify(await q15SubscriptionAndServices(accountId)));
                console.log('Q16 non-NEW orders:');
                console.table(await q16NonNewOrders(accountId));
            }
        }

        // 3. RESULT NEXT TO THE SHEET
        const expectedReminder = withDay(dueDate, scenario.expectedReminder);
        const expectedSuspension = withDay(dueDate, scenario.expectedSuspension);
        const last = await unit();

        console.log('================================================');
        console.log(`RESULT ${scenario.name} | invoice ${bill.invoiceId} due ${dueDate}`);
        console.log(`Grace given: ${graceGiven ? 'yes' : 'NO'}`);
        console.log(`Reminder: ${reminder || 'none'} | Sheet expects ${expectedReminder}: ${reminder === expectedReminder ? 'MATCH' : 'DIFFERS'}`);
        console.log(`Suspension: ${suspension ? `${suspension} (${dayName(suspension)}${isWeekend(suspension) ? ', weekend kept' : ''}, ${suspendOrderId})` : `none by ${withDay(dueDate, scenario.lastDay)}; unit plans ${last?.action ?? '-'} on ${last?.nextActionDate ?? '-'}`} | Sheet expects ${expectedSuspension} (${dayName(expectedSuspension)}): ${suspension === expectedSuspension ? 'MATCH' : 'DIFFERS'}`);
        console.log(`Notice: ${notice || 'none shown'} | Sheet expects ${suspension ? addDays(suspension, 1) : 'suspension + 1'}: ${suspension && notice === addDays(suspension, 1) ? 'MATCH' : 'DIFFERS'}`);
        console.log('================================================');

        results.push({ scenario: scenario.name, dueDate, reminder, suspension, notice, suspendOrderId });

        // 4. PAY AND RECONNECT FOR THE NEXT SCENARIO (as TC-10)
        await payAllOutstandingInvoices(page, request, accountId);

        if (suspension) {
            await page.waitForTimeout(5000);
            await processOrder(page, accountId, 'RESUME');
        }
    }

    console.log('================================================');
    console.log('PASS: 790115 TC-23 COMPLETE');
    console.log(`Account: ${accountId}`);
    console.table(results);
    console.log('================================================');
});
