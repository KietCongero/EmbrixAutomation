import { test } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import {
    login,
    verifyServiceStatus,
    getOutstandingInvoices,
    runNextBillingCycle,
    cleanJobs,
    processDay,
    getCcpTime,
    readCollectionUnit,
    processOrder,
    payInvoices,
    waitForInvoiceClosed,
    payAllOutstandingInvoices,
    withDay,
    addDays,
    eachDay,
    isWeekend,
} from '../helpers';

// 790115 TC-24 (EFT-102): ESPECIAL collection profile. The account is created with TC-01 and
// ACCOUNT_TEMPLATE=test-data/tc790115-24-account.json (collectionProfile "ESPECIAL", the value
// stored for Coope's UAT contract 790134). Same month loop as TC-21: bill, and either pay the
// invoice or run its collection day by day, until each wanted scenario has run:
//   PLAIN     first invoice: reminder due + 1, second reminder due + 11, suspension due + 12,
//             cancellation notice suspension + 10 (Huy's proposed profile, EFT-102 24-27 Oct)
//   WEEKEND   a month where due + 12 is a Saturday or Sunday: the date is kept (not moved)
//   FEBRUARY  due 18 Feb: suspension 2 Mar (1 Mar in a leap year), second reminder 1 Mar (29 Feb)
// The sandbox ESPECIAL schedule (COL_SCHEDULE47226) has only reminder + 1 and suspension + 12 today,
// so the second reminder and the notice report DIFFERS until the shared profile is changed.
// Dates are driven by the collection unit and logged next to the expectation, not asserted.

type ScenarioName = 'PLAIN' | 'WEEKEND' | 'FEBRUARY';

const WANTED: ScenarioName[] = (process.env.SCENARIOS?.split(',').map(s => s.trim().toUpperCase()) as ScenarioName[] | undefined) ?? ['PLAIN', 'WEEKEND', 'FEBRUARY'];
const MAX_CYCLES = Number(process.env.MAX_CYCLES ?? 14);
const SUSPENSION_OFFSET = 12;
const SECOND_REMINDER_OFFSET = 11;
const NOTICE_OFFSET = 10;

const dayName = (date: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${date}T00:00:00Z`).getUTCDay()];
const compare = (label: string, actual: string, expected: string) => console.log(`${label}: ${actual || 'none'} | expected ${expected}: ${actual === expected ? 'MATCH' : 'DIFFERS'}`);

test('790115 TC-24 - ESPECIAL profile: suspension at due + 12, weekend kept, February', async ({ page, request }) => {
    test.setTimeout(150 * 60 * 1000);

    const accountId = ACCOUNT_ID;
    const done = new Set<ScenarioName>();

    await login(page);

    for (let cycle = 1; cycle <= MAX_CYCLES && done.size < WANTED.length; cycle++) {
        await verifyServiceStatus(page, accountId, 'ACTIVE');

        const outstanding = await getOutstandingInvoices(page, accountId);
        const bill = outstanding.length > 0 ? outstanding[outstanding.length - 1] : await runNextBillingCycle(page, accountId, `BILLING CYCLE ${cycle}`);
        const dueDate = bill.dueDate;
        const expectedSuspension = addDays(dueDate, SUSPENSION_OFFSET);

        const scenario: ScenarioName = dueDate.slice(5, 7) === '02' ? 'FEBRUARY' : isWeekend(expectedSuspension) ? 'WEEKEND' : 'PLAIN';

        console.log(`Cycle ${cycle}: invoice ${bill.invoiceId} due ${dueDate} | due + 12 = ${expectedSuspension} (${dayName(expectedSuspension)}) | scenario ${scenario}`);

        if (!WANTED.includes(scenario) || done.has(scenario)) {
            console.log(`Scenario ${scenario} not needed: paying invoice ${bill.invoiceId} and billing the next month`);
            await payInvoices(request, accountId, [{ invoiceId: bill.invoiceId, amount: bill.due }]);
            await waitForInvoiceClosed(page, accountId, bill.invoiceId);
            continue;
        }

        console.log('================================================');
        console.log(`SCENARIO ${scenario} | invoice ${bill.invoiceId} due ${dueDate}`);
        console.log('================================================');

        // Once, before the collection starts (demo leftovers only); never once it has started
        const ccpTime = await getCcpTime(page);
        const lastDay = addDays(expectedSuspension, 2);
        const firstDay = ccpTime > dueDate ? ccpTime : dueDate;

        if (ccpTime < dueDate) for (const date of eachDay(withDay(dueDate, 16), lastDay)) await cleanJobs(date);

        const unit = () => readCollectionUnit(page, accountId, bill.invoiceId);

        let firstReminder = '';
        let secondReminder = '';
        let suspension = '';
        let notice = '';
        let suspendOrderId = '';

        for (const day of eachDay(firstDay, lastDay)) {
            const planned = await unit();
            const suspendsToday = planned?.action === 'INACTIVATE_SUBSCRIPTION' && planned.nextActionDate === day;

            await processDay(page, day);

            const current = await unit();
            console.log(`${day} (${dayName(day)}) processed | unit ${current ? `${current.status}: ${current.action || 'no next action'} ${current.nextActionDate}` : 'not shown'}`);

            for (const row of [planned, current]) {
                if (row?.action === 'FIRST_REMINDER_EMAIL') firstReminder = row.nextActionDate;
                if (row?.action === 'SECOND_REMINDER_EMAIL') secondReminder = row.nextActionDate;
                if (row?.action === 'NOTIFY_CANCELLATION_TO_CRM') notice = row.nextActionDate;
            }
            // Entry and reminder can run in the same job; the unit then shows the reminder only as its last action.
            if (!firstReminder && current?.action && current.action !== 'FIRST_REMINDER_EMAIL' && current.lastActionDate === addDays(dueDate, 1)) firstReminder = current.lastActionDate;

            if (suspendsToday) {
                suspendOrderId = await processOrder(page, accountId, 'SUSPEND');
                suspension = day;
            }

            if (suspension && (notice || day > suspension)) break;
        }

        const last = await unit();

        console.log('================================================');
        console.log(`RESULT ${scenario} | invoice ${bill.invoiceId} due ${dueDate}`);
        compare('First reminder', firstReminder, addDays(dueDate, 1));
        compare('Second reminder', secondReminder, addDays(dueDate, SECOND_REMINDER_OFFSET));
        compare(`Suspension${suspension ? ` (${dayName(suspension)}${isWeekend(suspension) ? ', weekend kept' : ''}, ${suspendOrderId})` : ''}`, suspension || `none by ${lastDay}; unit plans ${last?.action ?? '-'} on ${last?.nextActionDate ?? '-'}`, `${expectedSuspension} (${dayName(expectedSuspension)})`);
        compare('Cancellation notice', notice, suspension ? addDays(suspension, NOTICE_OFFSET) : addDays(expectedSuspension, NOTICE_OFFSET));
        console.log('================================================');

        done.add(scenario);

        // Pay and reconnect for the next cycle (as TC-10)
        await payAllOutstandingInvoices(page, request, accountId);

        if (suspension) {
            await page.waitForTimeout(5000);
            await processOrder(page, accountId, 'RESUME');
        }
    }

    const missing = WANTED.filter(s => !done.has(s));

    console.log('================================================');
    console.log(`${missing.length === 0 ? 'PASS' : 'INCOMPLETE'}: 790115 TC-24 | scenarios run: ${[...done].join(', ') || 'none'}${missing.length ? ` | not reached in ${MAX_CYCLES} cycles: ${missing.join(', ')}` : ''}`);
    console.log(`Account: ${accountId}`);
    console.log('================================================');
});
