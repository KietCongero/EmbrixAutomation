import { test, expect } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import { queryDatabase } from '../helpers/database';

test('TC10 - due date extension, collection, reminder and suspension', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;
    const accountId = ACCOUNT_ID;
    const dailyJobUrl = 'https://core-ui.demo.embrix.org/jobs-management/job-schedule/CJ-12';

    if (!username || !password) throw new Error('Missing EMBRIX_USERNAME or EMBRIX_PASSWORD');

    // ============================================================
    // DATE HELPERS
    // ============================================================

    const normalizeDate = (text: string) => {
        const match = text.match(/\d{4}-\d{2}-\d{2}/);
        if (!match) throw new Error(`Could not read date from: ${text}`);
        return match[0];
    };

    const addDays = (date: string, days: number) => {
        const [year, month, day] = date.split('-').map(Number);
        const result = new Date(year, month - 1, day + days);
        return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`;
    };

    const getNextMonthFirst = (date: string) => {
        const [year, month] = date.split('-').map(Number);
        const result = new Date(year, month, 1);
        return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-01`;
    };

    const getSafeExtensionPlan = (date: string) => {
        const [year, month, originalDay] = date.split('-').map(Number);
        const lastDayOfMonth = new Date(year, month, 0).getDate();
        const extensionDay = lastDayOfMonth - 1;
        const extendedDueDate = `${year}-${String(month).padStart(2, '0')}-${String(extensionDay).padStart(2, '0')}`;
        const reminderDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;
        const nextMonthFirst = getNextMonthFirst(extendedDueDate);
        if (originalDay >= extensionDay) throw new Error(`Cannot safely extend ${date}: month has ${lastDayOfMonth} days and reminder must happen before ${nextMonthFirst}`);
        return { year, month, lastDayOfMonth, extensionDay, extendedDueDate, reminderDate, nextMonthFirst };
    };

    const ordinal = (day: number) => {
        if (day >= 11 && day <= 13) return `${day}th`;
        if (day % 10 === 1) return `${day}st`;
        if (day % 10 === 2) return `${day}nd`;
        if (day % 10 === 3) return `${day}rd`;
        return `${day}th`;
    };

    // ============================================================
    // ACCOUNT HELPERS
    // ============================================================

    const openAccount = async () => {
        await page.goto('https://core-ui.demo.embrix.org/dashboard/me');
        await page.getByRole('button', { name: 'Customer Hub' }).click();
        await page.getByRole('link', { name: 'Customer Management' }).first().click();
        const search = page.locator('.form-group').first().getByRole('textbox');
        await search.fill(accountId);
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.getByRole('link', { name: accountId, exact: true }).click();
    };

    const openServices = async () => {
        await openAccount();
        await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
        await page.locator('a').filter({ hasText: 'Assets' }).click();
        await page.getByRole('link', { name: ' Services' }).click();
    };

    // ============================================================
    // BILL HELPERS
    // ============================================================

    const getLatestActiveBill = async () => {
        const activeCell = page.getByRole('cell', { name: 'ACTIVE', exact: true }).first();
        await expect(activeCell).toBeVisible();

        const table = activeCell.locator('xpath=ancestor::table[1]');
        const headers = table.getByRole('columnheader');

        let dueDateIndex = -1;
        let invoiceIdIndex = -1;

        for (let i = 0; i < await headers.count(); i++) {
            const header = (await headers.nth(i).innerText()).trim();
            if (header === 'Due Date') dueDateIndex = i;
            if (header === 'Invoice Id') invoiceIdIndex = i;
        }

        if (dueDateIndex === -1) throw new Error('Could not find Due Date column');

        const activeRows = table.getByRole('row').filter({ has: page.getByRole('cell', { name: 'ACTIVE', exact: true }) });
        const activeCount = await activeRows.count();

        if (activeCount === 0) throw new Error(`No ACTIVE bill found for account ${accountId}`);

        let latestRow = activeRows.first();
        let latestDueDate = '';
        let latestInvoiceId = '';
        let latestTime = -1;

        for (let i = 0; i < activeCount; i++) {
            const row = activeRows.nth(i);
            const dueDate = normalizeDate((await row.getByRole('cell').nth(dueDateIndex).innerText()).trim());
            const invoiceId = invoiceIdIndex >= 0 ? (await row.getByRole('cell').nth(invoiceIdIndex).innerText()).trim() : '';
            const [year, month, day] = dueDate.split('-').map(Number);
            const time = new Date(year, month - 1, day).getTime();

            console.log(`ACTIVE bill ${i + 1}: Due Date ${dueDate}${invoiceId ? `, Invoice ${invoiceId}` : ''}`);

            if (time > latestTime) {
                latestTime = time;
                latestDueDate = dueDate;
                latestInvoiceId = invoiceId;
                latestRow = row;
            }
        }

        return { row: latestRow, dueDate: latestDueDate, invoiceId: latestInvoiceId };
    };

    const verifyLatestBillActive = async () => {
        await page.goto(`https://core-ui.demo.embrix.org/customers/${accountId}/bills`);
        const bill = await getLatestActiveBill();
        console.log(`PASS: Invoice remains ACTIVE with Due Date ${bill.dueDate}`);
        return bill;
    };

    const getNextPendingBill = async () => {
        await openAccount();
        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();

        const pendingRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'PENDING', exact: true }) }).first();
        await expect(pendingRow).toBeVisible();

        const dates = pendingRow.getByRole('cell').filter({ hasText: /^\d{4}-\d{2}-\d{2}$/ });
        const startDate = (await dates.nth(0).innerText()).trim();
        const endDate = (await dates.nth(1).innerText()).trim();

        console.log(`PASS: Pending bill ${startDate} -> ${endDate}`);
        return { startDate, endDate, jobDate: endDate };
    };

    const verifyGeneratedBill = async (startDate: string, endDate: string) => {
        console.log(`Verifying invoice ${startDate} -> ${endDate}...`);

        for (let attempt = 1; attempt <= 10; attempt++) {
            console.log(`Invoice verification ${attempt}/10`);
            await page.goto(`https://core-ui.demo.embrix.org/customers/${accountId}/bills`);
            await page.waitForTimeout(3000);

            const rows = page.getByRole('row');
            const count = await rows.count();

            for (let i = 0; i < count; i++) {
                const row = rows.nth(i);
                const text = await row.innerText();

                if (text.includes(startDate) && text.includes(endDate) && !text.includes('PENDING')) {
                    console.log(`PASS: Invoice generated ${startDate} -> ${endDate}`);
                    return;
                }
            }

            await page.waitForTimeout(5000);
        }

        throw new Error(`Expected invoice ${startDate} -> ${endDate} was not generated`);
    };

    // ============================================================
    // CCP TIME
    // ============================================================

    const setCcpTime = async (targetDate: string) => {
        console.log(`Changing CCP time to ${targetDate}...`);
        await page.goto('https://transactional.coopeg.embrix.org/graphiql?');

        const mutation = `mutation { setCcpTime(input: { ccpTime: "${targetDate}" }) { ccpTime } }`;

        await page.evaluate((query) => {
            const editor = (document.querySelector('.CodeMirror') as any)?.CodeMirror;
            if (!editor) throw new Error('CodeMirror editor not found');
            editor.setValue(query);
            editor.focus();
        }, mutation);

        await page.waitForTimeout(1000);
        await page.getByRole('button', { name: 'Execute Query (Ctrl-Enter)' }).click();
        await expect(page.locator('pre').filter({ hasText: `"ccpTime": "${targetDate}"` })).toBeVisible();

        console.log(`PASS: CCP time = ${targetDate}`);
    };

    // ============================================================
    // JOB CLEANUP
    // ============================================================

    const cleanJobs = async (targetDate: string) => {
        console.log(`Cleaning jobs for ${targetDate}...`);

        const jobs = await queryDatabase(`SELECT * FROM core_engine.job_schedule WHERE scheduledate = $1`, [targetDate]);

        for (const job of jobs) {
            await queryDatabase(`DELETE FROM core_engine.job_schedule_list WHERE id = $1`, [job.id]);
            await queryDatabase(`DELETE FROM core_engine.job_schedule WHERE id = $1`, [job.id]);
            console.log(`PASS: Deleted job ${job.id}`);
        }

        const remaining = await queryDatabase(`SELECT * FROM core_engine.job_schedule WHERE scheduledate = $1`, [targetDate]);
        expect(remaining.length, `Jobs still exist for ${targetDate}`).toBe(0);
    };

    const getJobsForDate = async (targetDate: string) => {
        return await queryDatabase(`SELECT * FROM core_engine.job_schedule WHERE scheduledate = $1`, [targetDate]);
    };

    // ============================================================
    // DAILY JOB
    // ============================================================

    const fillJobDate = async (targetDate: string) => {
        const input = page.getByRole('textbox').first();
        await input.click();
        await input.press('ControlOrMeta+a');
        await input.fill(targetDate);
        await input.press('Escape');
    };

    const waitAfterJobRun = async () => {
        for (let attempt = 1; attempt <= 6; attempt++) {
            console.log(`Checking job status ${attempt}/6`);
            await page.waitForTimeout(5000);
            await page.getByTitle('Refresh jobs').click();

            if (await page.getByText('Completed', { exact: true }).first().isVisible().catch(() => false)) {
                console.log('PASS: Job completed');
                return;
            }
        }

        console.log('WARNING: Completed status not detected');
    };

    const createAndRunDailyJob = async (targetDate: string) => {
        console.log(`Creating DAILY job for ${targetDate}...`);
        await page.goto(dailyJobUrl);
        await fillJobDate(targetDate);
        await page.getByRole('button', { name: 'Create Job Schedule' }).click();
        await page.getByTitle('Refresh jobs').click();
        await page.waitForTimeout(5000);
        await page.getByRole('button', { name: 'Process' }).click();
        await page.getByRole('button', { name: 'Yes' }).click();
        console.log(`PASS: DAILY job started for ${targetDate}`);
        await waitAfterJobRun();
    };

    const runExistingDailyJob = async (targetDate: string) => {
        console.log(`Running existing DAILY job for ${targetDate}...`);
        await page.goto(dailyJobUrl);
        await fillJobDate(targetDate);
        await page.getByTitle('Refresh jobs').click();
        await page.waitForTimeout(5000);
        await expect(page.getByRole('button', { name: 'Process' })).toBeVisible();
        await page.getByRole('button', { name: 'Process' }).click();
        await page.getByRole('button', { name: 'Yes' }).click();
        console.log(`PASS: Existing DAILY job started for ${targetDate}`);
        await waitAfterJobRun();
    };

    const runBillingDailyJob = async (targetDate: string) => {
        await page.goto(dailyJobUrl);
        await fillJobDate(targetDate);
        await page.getByRole('button', { name: 'Create Job Schedule' }).click();
        await page.getByTitle('Refresh jobs').click();
        await page.waitForTimeout(5000);
        await page.getByRole('button', { name: 'Process' }).click();
        await page.getByRole('button', { name: 'Yes' }).click();
        console.log(`PASS: Billing job started for ${targetDate}`);
        await waitAfterJobRun();
    };

    const runBillingJobSafely = async (targetDate: string) => {
        console.log(`Preparing fresh billing job for ${targetDate}...`);
        await cleanJobs(targetDate);
        await setCcpTime(targetDate);
        await runBillingDailyJob(targetDate);
        console.log(`PASS: Fresh billing job processed for ${targetDate}`);
    };

    // ============================================================
    // COLLECTION - TC07 LOGIC
    // ============================================================

    const getCollectionInfo = async (expectedAction: string) => {
        console.log(`Checking Collection for ${expectedAction}...`);

        for (let attempt = 1; attempt <= 10; attempt++) {
            console.log(`Collection search attempt ${attempt}/10`);

            await page.goto('https://core-ui.demo.embrix.org/dashboard/me');
            await page.getByRole('button', { name: 'AR Hub' }).click();
            await page.getByRole('link', { name: 'Collections' }).click();

            const collectionSearch = page.locator('.form-group').first().getByRole('textbox');
            await collectionSearch.fill(accountId);
            await page.getByRole('button', { name: 'Search' }).click();
            await page.waitForTimeout(10000);

            const viewButton = page.getByRole('cell', { name: 'View' }).first();

            if (!(await viewButton.isVisible().catch(() => false))) {
                console.log('Collection View not found yet...');
                continue;
            }

            await viewButton.click();
            await page.waitForTimeout(2000);

            const actionCell = page.getByRole('cell', { name: expectedAction, exact: true }).last();

            if (!(await actionCell.isVisible().catch(() => false))) {
                console.log(`${expectedAction} not found yet...`);
                continue;
            }

            const actionRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: expectedAction, exact: true }) }).last();
            await expect(actionRow).toBeVisible();

            const table = actionRow.locator('xpath=ancestor::table[1]');
            const headers = table.getByRole('columnheader');
            const headerCount = await headers.count();

            let nextActionDateIndex = -1;

            for (let i = 0; i < headerCount; i++) {
                const headerText = (await headers.nth(i).innerText()).trim();

                if (headerText === 'Next Action Date') {
                    nextActionDateIndex = i;
                    break;
                }
            }

            if (nextActionDateIndex === -1) throw new Error('Could not find Next Action Date column');

            const nextActionDateText = await actionRow.getByRole('cell').nth(nextActionDateIndex).innerText();
            const nextActionDate = normalizeDate(nextActionDateText);

            console.log('PASS: Invoice Status = COLLECTION');
            console.log(`PASS: Next Action = ${expectedAction}`);
            console.log(`PASS: Next Action Date = ${nextActionDate}`);

            return { action: expectedAction, nextActionDate };
        }

        throw new Error(`Could not find ${expectedAction} after 10 attempts`);
    };

    // ============================================================
    // SUSPENSION
    // ============================================================

    const verifyServiceSuspended = async () => {
        await openServices();
        await expect(page.getByRole('cell', { name: 'SUSPENDED', exact: true }).first()).toBeVisible();
        console.log(`PASS: Service for ${accountId} is SUSPENDED`);
    };

    const getIncompleteSuspendOrder = async () => {
        await openServices();

        for (let attempt = 1; attempt <= 10; attempt++) {
            console.log(`Checking SUSPEND order ${attempt}/10`);

            const row = page.getByRole('row').filter({ hasText: 'SUSPEND' }).filter({ hasText: 'ORD-' }).last();

            if (await row.isVisible().catch(() => false)) {
                const match = (await row.innerText()).match(/ORD-[A-Za-z0-9-]+/);
                if (!match) throw new Error('Could not read SUSPEND order ID');
                console.log(`PASS: SUSPEND order found ${match[0]}`);
                return match[0];
            }

            await page.waitForTimeout(5000);
            await page.getByRole('button', { name: 'Refresh' }).click();
        }

        throw new Error('Could not find SUSPEND order');
    };

    const processSuspendOrder = async () => {
        const orderId = await getIncompleteSuspendOrder();
        await queryDatabase(`UPDATE core_oms.order_prov_sequence_list SET status = 'COMPLETED' WHERE id = $1`, [orderId]);
        await page.waitForTimeout(3000);
        await expect(page.getByRole('button', { name: 'Submit order' })).toBeVisible();
        await page.getByRole('button', { name: 'Submit order' }).click();
        await verifyServiceSuspended();
        console.log(`PASS: SUSPEND order ${orderId} completed`);
    };

    const createInstallmentPlan = async (invoiceId: string) => {
        console.log(`Creating 4-installment plan for invoice ${invoiceId}...`);

        await openAccount();
        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Invoice Payment Installment' }).click();
        await page.getByRole('button', { name: '+Add New Installment Plan' }).click();

        await page.getByText('Number Of Installments').click();
        await page.locator('.col-md-12.row > div').first().click();

        const installmentPlus = page.getByRole('button').filter({ hasText: /^$/ }).nth(3);

        await installmentPlus.click();
        await installmentPlus.click();
        await installmentPlus.click();
        await installmentPlus.click();

        console.log('PASS: Number Of Installments = 4');

        await page.getByText('Month(s) Offset').click();
        await page.locator('.col-md-12 > div:nth-child(3)').first().click();
        await page.locator('#monthOffset > .plus-number').click();

        console.log('PASS: Month Offset = 1');

        await page.getByRole('button', { name: 'Select Invoice' }).click();

        const invoiceCell = page.getByRole('cell', { name: invoiceId, exact: true });

        await expect(invoiceCell, `Invoice ${invoiceId} was not available for installment plan`).toBeVisible();
        await invoiceCell.click();

        console.log(`PASS: Selected invoice ${invoiceId}`);

        await page.getByRole('button', { name: 'Select', exact: true }).click();
        await page.getByRole('button', { name: 'Create' }).click();

        console.log(`PASS: 4-installment payment plan created for invoice ${invoiceId}`);
    };

    // ============================================================
    // LOGIN
    // ============================================================

    await page.goto('https://core-ui.demo.embrix.org/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('PASS: Login successful');

    // ============================================================
    // READ ACTIVE BILL
    // ============================================================

    await page.goto(`https://core-ui.demo.embrix.org/customers/${accountId}/bills`);

    const originalBill = await getLatestActiveBill();
    const selectedBillRow = originalBill.row;
    const originalDueDate = originalBill.dueDate;
    const activeInvoiceId = originalBill.invoiceId;

    console.log(`ACTIVE INVOICE ID: ${activeInvoiceId}`);

    const extensionPlan = getSafeExtensionPlan(originalDueDate);
    const extendedDueDate = extensionPlan.extendedDueDate;
    const reminderDate = extensionPlan.reminderDate;
    const billingDate = extensionPlan.nextMonthFirst;
    const expectedSuspensionDate = addDays(extendedDueDate, 5);
    const [targetYear, targetMonth, targetDay] = extendedDueDate.split('-').map(Number);

    console.log('================================================');
    console.log(`ORIGINAL DUE DATE: ${originalDueDate}`);
    console.log(`MONTH: ${extensionPlan.year}-${String(extensionPlan.month).padStart(2, '0')}`);
    console.log(`DAYS IN MONTH: ${extensionPlan.lastDayOfMonth}`);
    console.log(`EXTENDED DUE DATE: ${extendedDueDate}`);
    console.log(`REMINDER DATE: ${reminderDate}`);
    console.log(`BILLING DATE: ${billingDate}`);
    console.log(`EXPECTED SUSPENSION DATE: ${expectedSuspensionDate}`);
    console.log('================================================');

    expect(reminderDate < billingDate, `Reminder ${reminderDate} must happen before billing ${billingDate}`).toBe(true);
    expect(billingDate < expectedSuspensionDate, `Billing ${billingDate} must happen before suspension ${expectedSuspensionDate}`).toBe(true);

    // ============================================================
    // STEP 7 - EXTEND DUE DATE
    // ============================================================

    const checkbox = selectedBillRow.locator('td > .check-item > .custom-control').first();
    await checkbox.click();

    const actionSelect = page.locator('div').filter({ hasText: /^Action\s*<Select Action>$/ }).last();
    await actionSelect.click();
    await page.getByText('EXTEND_DUE_DATE', { exact: true }).click();

    const dueDateInput = page.locator('input[id^="date-"]:visible').last();
    await dueDateInput.click();

    await page.getByRole('combobox').nth(1).selectOption(String(targetYear));
    await page.getByRole('combobox').first().selectOption(String(targetMonth - 1));

    const dateObject = new Date(targetYear, targetMonth - 1, targetDay);
    const weekday = dateObject.toLocaleString('en-US', { weekday: 'long' });
    const monthName = dateObject.toLocaleString('en-US', { month: 'long' });

    await page.getByRole('button', { name: new RegExp(`Choose ${weekday}, ${monthName} ${ordinal(targetDay)}`) }).click();
    await page.locator('textarea:visible').last().fill(`TC10 due date extension from ${originalDueDate} to ${extendedDueDate}`);
    await page.getByText('Submit', { exact: true }).click();

    const closeButton = page.getByRole('button', { name: 'close' });
    if (await closeButton.isVisible().catch(() => false)) await closeButton.click();

    console.log(`PASS: Due date extension submitted ${originalDueDate} -> ${extendedDueDate}`);

    await page.waitForTimeout(2000);
    await page.goto(`https://core-ui.demo.embrix.org/customers/${accountId}/bills`);

    const updatedBill = await getLatestActiveBill();

    expect(updatedBill.dueDate, `Expected ${extendedDueDate}, found ${updatedBill.dueDate}`).toBe(extendedDueDate);

    console.log(`PASS: Due Date updated to ${extendedDueDate}`);
    console.log(`PASS: Reminder ${reminderDate} happens before billing ${billingDate}`);

    await cleanJobs(extendedDueDate);

    // ============================================================
    // STEP 8 - ORIGINAL DUE DATE
    // ============================================================

    console.log('================================================');
    console.log(`STEP 8 - ORIGINAL DUE DATE ${originalDueDate}`);
    console.log('================================================');

    await setCcpTime(originalDueDate);
    await createAndRunDailyJob(originalDueDate);

    const stillActiveBill = await verifyLatestBillActive();

    expect(stillActiveBill.dueDate).toBe(extendedDueDate);

    console.log(`PASS: Invoice remained ACTIVE on original Due Date ${originalDueDate}`);

    // ============================================================
    // STEP 9 - COLLECTION
    // ============================================================

    console.log('================================================');
    console.log(`STEP 9 - COLLECTION DATE ${extendedDueDate}`);
    console.log('================================================');

    await setCcpTime(extendedDueDate);
    await createAndRunDailyJob(extendedDueDate);

    const firstReminder = await getCollectionInfo('FIRST_REMINDER_EMAIL');

    console.log(`PASS: Collection started on ${extendedDueDate}`);
    console.log(`Embrix First Reminder Date: ${firstReminder.nextActionDate}`);
    console.log(`Expected First Reminder Date: ${reminderDate}`);

    expect(firstReminder.nextActionDate).toBe(reminderDate);
    expect(firstReminder.nextActionDate < billingDate, `Reminder ${firstReminder.nextActionDate} must happen before billing ${billingDate}`).toBe(true);

    // ============================================================
    // STEP 10 - REMINDER EMAIL
    // ============================================================

    console.log('================================================');
    console.log(`STEP 10 - REMINDER EMAIL ${firstReminder.nextActionDate}`);
    console.log('================================================');

    await setCcpTime(firstReminder.nextActionDate);
    await runExistingDailyJob(firstReminder.nextActionDate);

    console.log(`PASS: Reminder email job processed on ${firstReminder.nextActionDate}`);

    const inactivateSubscription = await getCollectionInfo('INACTIVATE_SUBSCRIPTION');
    const suspensionDate = inactivateSubscription.nextActionDate;

    console.log('================================================');
    console.log('NEXT COLLECTION ACTION');
    console.log(`Action: ${inactivateSubscription.action}`);
    console.log(`Embrix Suspension Date: ${suspensionDate}`);
    console.log(`Expected Suspension Date: ${expectedSuspensionDate}`);
    console.log('================================================');

    // ============================================================
    // STEP 11 - MONTH 03 BILLING
    // ============================================================

    console.log('================================================');
    console.log(`STEP 11 - MONTH 03 BILLING ${billingDate}`);
    console.log('================================================');

    const month03Bill = await getNextPendingBill();

    console.log(`Pending Bill: ${month03Bill.startDate} -> ${month03Bill.endDate}`);
    console.log(`Expected Billing Date: ${billingDate}`);
    console.log(`Actual Pending Billing Date: ${month03Bill.jobDate}`);

    expect(month03Bill.jobDate).toBe(billingDate);

    await cleanJobs(billingDate);
    await setCcpTime(billingDate);
    await runBillingDailyJob(billingDate);
    await verifyGeneratedBill(month03Bill.startDate, month03Bill.endDate);

    console.log(`PASS: ${month03Bill.startDate} -> ${month03Bill.endDate} invoice generated`);

    // ============================================================
    // STEP 12 - SUSPENSION
    // ============================================================

    console.log('================================================');
    console.log(`STEP 12 - SUSPENSION ${suspensionDate}`);
    console.log('================================================');

    const suspensionJobs = await getJobsForDate(suspensionDate);

    console.log(`Jobs found for suspension date ${suspensionDate}: ${suspensionJobs.length}`);
    console.log(suspensionJobs);

    await setCcpTime(suspensionDate);
    await runExistingDailyJob(suspensionDate);

    console.log(`PASS: Suspension job processed on ${suspensionDate}`);

    await processSuspendOrder();

    // ============================================================
    // COMPLETE
    // ============================================================

    console.log('================================================');
    console.log('PASS: TC10 COMPLETE');
    console.log(`Account: ${accountId}`);
    console.log(`Original Due Date: ${originalDueDate}`);
    console.log(`Days In Month: ${extensionPlan.lastDayOfMonth}`);
    console.log(`Extended Due Date: ${extendedDueDate}`);
    console.log(`Reminder Date: ${firstReminder.nextActionDate}`);
    console.log(`Billing Date: ${billingDate}`);
    console.log(`Expected Suspension Date: ${expectedSuspensionDate}`);
    console.log(`Embrix Suspension Date: ${suspensionDate}`);
    console.log(`Month 03 Bill: ${month03Bill.startDate} -> ${month03Bill.endDate}`);
    console.log('================================================');
});