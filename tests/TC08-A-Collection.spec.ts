import { test, expect } from '@playwright/test';
import { queryDatabase } from '../helpers/database';
import { ACCOUNT_ID } from '../test-data/testIds';
import { env } from '../config/environments';

test('next billing cycle -> collection -> stop before inactivate subscription', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const username = env.username;
    const password = env.password;
    const accountId = ACCOUNT_ID;

    const dailyJobUrl = '/jobs-management/job-schedule/CJ-12';

    if (!username || !password) throw new Error('Missing username or password');

    // ============================================================
    // DATE HELPER
    // ============================================================

    const normalizeDate = (text: string) => {
        const match = text.match(/\d{4}-\d{2}-\d{2}/);
        if (!match) throw new Error(`Could not find date in: ${text}`);
        return match[0];
    };

    // ============================================================
    // OPEN ACCOUNT
    // ============================================================

    const openAccount = async () => {
        await page.goto('/dashboard/me');
        await page.getByRole('button', { name: 'Customer Hub' }).click();
        await page.getByRole('link', { name: 'Customer Management' }).first().click();

        const accountSearch = page.locator('.form-group').first().getByRole('textbox');

        await accountSearch.fill(accountId);
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.getByRole('link', { name: accountId, exact: true }).click();

        console.log(`PASS: Account ${accountId} opened`);
    };

    // ============================================================
    // CCP TIME
    // ============================================================

    const setCcpTime = async (targetDate: string) => {
        console.log(`Changing CCP time to ${targetDate}...`);

        await page.goto(env.graphiqlUrl);

        const mutation = `mutation {
  setCcpTime(input: {
    ccpTime: "${targetDate}"
  })
  {
    ccpTime
  }
}`;

        await page.evaluate((query) => { const editorElement = document.querySelector('.CodeMirror'); const codeMirror = (editorElement as any)?.CodeMirror; if (!codeMirror) throw new Error('CodeMirror editor not found'); codeMirror.setValue(query); codeMirror.focus(); }, mutation);
        await page.waitForTimeout(1000);
        await page.getByRole('button', { name: 'Execute Query (Ctrl-Enter)' }).click();
        await expect(page.locator('pre').filter({ hasText: `"ccpTime": "${targetDate}"` })).toBeVisible();

        console.log(`PASS: CCP time changed to ${targetDate}`);
    };

    // ============================================================
    // CLEAN JOBS FOR ONE DATE
    // ============================================================

    const cleanJobs = async (targetDate: string) => {
        console.log(`Cleaning jobs for ${targetDate}...`);

        const jobs = await queryDatabase(`SELECT * FROM core_engine.job_schedule WHERE scheduledate = $1`, [targetDate]);

        console.log(`Found ${jobs.length} existing job(s)`);

        for (const job of jobs) {
            await queryDatabase(`DELETE FROM core_engine.job_schedule_list WHERE id = $1`, [job.id]);
            await queryDatabase(`DELETE FROM core_engine.job_schedule WHERE id = $1`, [job.id]);

            console.log(`PASS: Deleted job ${job.id}`);
        }

        const remainingJobs = await queryDatabase(`SELECT * FROM core_engine.job_schedule WHERE scheduledate = $1`, [targetDate]);

        expect(remainingJobs.length, `Jobs still exist for ${targetDate}`).toBe(0);

        console.log(`PASS: Jobs cleaned for ${targetDate}`);
    };

    // ============================================================
    // CLEAN ALL COLLECTION JOBS FROM 16TH -> END OF MONTH
    //
    // IMPORTANT:
    // THIS ONLY HAPPENS BEFORE COLLECTION STARTS.
    // AFTER COLLECTION STARTS WE DO NOT DELETE EMBRIX JOBS.
    // ============================================================

    const cleanCollectionJobs = async (referenceDate: string) => {
        const [year, month] = referenceDate.split('-').map(Number);
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

        console.log('================================================');
        console.log(`Cleaning collection jobs from ${year}-${String(month).padStart(2, '0')}-16 through end of month`);
        console.log('================================================');

        for (let day = 16; day <= lastDay; day++) {
            const targetDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            await cleanJobs(targetDate);
        }

        console.log(`PASS: Collection jobs cleaned from day 16 through day ${lastDay}`);
    };

    // ============================================================
    // JOB HELPERS
    // ============================================================

    const fillJobDate = async (targetDate: string) => {
        const dateInput = page.getByRole('textbox').first();

        await dateInput.click();
        await dateInput.press('ControlOrMeta+a');
        await dateInput.fill(targetDate);
        await dateInput.press('Escape');

        console.log(`Job date selected: ${targetDate}`);
    };

    const waitAfterJobRun = async () => {
        let completedFound = false;

        for (let attempt = 1; attempt <= 6; attempt++) {
            console.log(`Refreshing jobs: ${attempt}/6`);

            await page.waitForTimeout(5000);
            await page.getByTitle('Refresh jobs').click();

            const completed = page.getByText('Completed', { exact: true }).first();

            if (await completed.isVisible().catch(() => false)) {
                completedFound = true;
                console.log('PASS: Job processing shows COMPLETED');
                break;
            }
        }

        if (!completedFound) console.log('WARNING: Completed status not detected');
    };

    // ============================================================
    // FIND NEXT PENDING BILL
    // ============================================================

    const getNextPendingBill = async () => {
        await openAccount();
        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();

        console.log('Looking for next PENDING bill...');

        const pendingBillRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'PENDING', exact: true }) }).first();

        await expect(pendingBillRow).toBeVisible();

        const dateCells = pendingBillRow.getByRole('cell').filter({ hasText: /^\d{4}-\d{2}-\d{2}$/ });

        await expect(dateCells.nth(0)).toBeVisible();
        await expect(dateCells.nth(1)).toBeVisible();

        const startDate = (await dateCells.nth(0).innerText()).trim();
        const endDate = (await dateCells.nth(1).innerText()).trim();

        console.log(`PASS: Pending bill found ${startDate} -> ${endDate}`);

        return {
            startDate,
            endDate,
            jobDate: endDate
        };
    };

    // ============================================================
    // RUN BILLING DAILY JOB
    // ============================================================

    const runBillingDailyJob = async (targetDate: string) => {
        console.log(`Running BILLING DAILY job for ${targetDate}...`);

        await page.goto('/dashboard/me');
        await page.getByRole('button', { name: 'Operations Hub' }).click();
        await page.getByRole('link', { name: 'Jobs Management' }).click();
        await page.locator('#sidebarnav a').filter({ hasText: 'Jobs Management' }).click();
        await page.getByRole('link', { name: ' DAILY' }).click();

        await fillJobDate(targetDate);
        await page.getByRole('button', { name: 'Create Job Schedule' }).click();

        console.log(`PASS: Billing job created for ${targetDate}`);

        await page.getByTitle('Refresh jobs').click();
        await page.waitForTimeout(2000);
        await page.getByRole('button', { name: 'Process' }).click();
        await page.getByRole('button', { name: 'Yes' }).click();

        console.log(`PASS: Billing processing started for ${targetDate}`);

        await page.waitForTimeout(15000);

        let invoiceFinished = false;
        let invoiceStatus = '';

        for (let attempt = 1; attempt <= 20; attempt++) {
            console.log(`Checking INVOICE_CHECK ${targetDate}: ${attempt}/20`);

            await page.getByTitle('Refresh jobs').click();
            await page.waitForTimeout(15000);

            const invoiceCheck = page.getByRole('heading', { name: 'INVOICE_CHECK' });

            if (!(await invoiceCheck.isVisible().catch(() => false))) {
                console.log('INVOICE_CHECK not visible yet...');
                continue;
            }

            const invoiceCompleted = page.getByTitle('Status: COMPLETED');
            const invoiceError = page.getByTitle('Status: ERROR');

            if (await invoiceCompleted.isVisible().catch(() => false)) {
                invoiceStatus = 'COMPLETED';
                invoiceFinished = true;
                console.log(`PASS: INVOICE_CHECK COMPLETED for ${targetDate}`);
                break;
            }

            if (await invoiceError.isVisible().catch(() => false)) {
                invoiceStatus = 'ERROR';
                invoiceFinished = true;
                console.log(`WARNING: INVOICE_CHECK ERROR for ${targetDate}`);
                break;
            }

            console.log('INVOICE_CHECK still processing...');
        }

        if (!invoiceFinished) {
            console.log(`WARNING: INVOICE_CHECK did not finish for ${targetDate}`);
            console.log('Continuing to bill verification...');
        }

        console.log(`Final INVOICE_CHECK status: ${invoiceStatus || 'UNKNOWN'}`);
    };

    // ============================================================
    // VERIFY GENERATED BILL + READ DUE DATE
    // ============================================================

    const getGeneratedBillDueDate = async (startDate: string, endDate: string) => {
        await openAccount();
        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();

        console.log(`Looking for newly generated STAMPED bill ${startDate} -> ${endDate}...`);

        await page.waitForTimeout(2000);
        await page.reload();

        let generatedBillRow = page.getByRole('row').filter({ hasText: startDate }).filter({ hasText: endDate }).filter({ hasText: 'STAMPED' }).first();

        for (let attempt = 1; attempt <= 10; attempt++) {
            if (await generatedBillRow.isVisible().catch(() => false)) break;

            console.log(`STAMPED bill not found. Reloading... ${attempt}/10`);

            await page.reload();
            await page.waitForTimeout(5000);

            generatedBillRow = page.getByRole('row').filter({ hasText: startDate }).filter({ hasText: endDate }).filter({ hasText: 'STAMPED' }).first();
        }

        await expect(generatedBillRow).toBeVisible();

        console.log(`PASS: STAMPED bill found ${startDate} -> ${endDate}`);

        const table = generatedBillRow.locator('xpath=ancestor::table[1]');
        const headers = table.getByRole('columnheader');
        const headerCount = await headers.count();

        let dueDateIndex = -1;

        for (let i = 0; i < headerCount; i++) {
            const headerText = (await headers.nth(i).innerText()).trim();

            if (headerText === 'Due Date') {
                dueDateIndex = i;
                break;
            }
        }

        if (dueDateIndex === -1) throw new Error('Could not find Due Date column');

        const cells = generatedBillRow.getByRole('cell');
        const dueDateText = await cells.nth(dueDateIndex).innerText();
        const dueDate = normalizeDate(dueDateText);

        console.log(`PASS: New invoice due date = ${dueDate}`);

        return dueDate;
    };

    // ============================================================
    // CREATE FIRST COLLECTION JOB
    // ONLY USED FOR COLLECTION CREATE
    // ============================================================

    const createAndRunDailyJob = async (targetDate: string) => {
        console.log(`Creating COLLECTION DAILY job for ${targetDate}...`);

        await page.goto(dailyJobUrl);
        await fillJobDate(targetDate);
        await page.getByRole('button', { name: 'Create Job Schedule' }).click();

        console.log(`PASS: Job schedule created for ${targetDate}`);

        await page.getByTitle('Refresh jobs').click();
        await page.waitForTimeout(5000);
        await page.getByRole('button', { name: 'Process' }).click();
        await page.getByRole('button', { name: 'Yes' }).click();

        console.log(`PASS: Processing started for ${targetDate}`);

        await waitAfterJobRun();
    };

    // ============================================================
    // RUN JOB CREATED BY EMBRIX
    //
    // DO NOT DELETE.
    // DO NOT RECREATE.
    // ============================================================

    const runExistingDailyJob = async (targetDate: string) => {
        console.log(`Running existing DAILY job for ${targetDate}...`);

        await page.goto(dailyJobUrl);
        await fillJobDate(targetDate);
        await page.getByTitle('Refresh jobs').click();
        await page.waitForTimeout(5000);

        await expect(page.getByRole('button', { name: 'Process' })).toBeVisible();
        await page.getByRole('button', { name: 'Process' }).click();
        await page.getByRole('button', { name: 'Yes' }).click();

        console.log(`PASS: Existing job processing started for ${targetDate}`);

        await waitAfterJobRun();
    };

    // ============================================================
    // READ COLLECTION NEXT ACTION
    // ============================================================

    const getCollectionInfo = async (expectedAction: string) => {
        console.log(`Checking Collection for ${expectedAction}...`);

        for (let attempt = 1; attempt <= 10; attempt++) {
            console.log(`Collection search attempt ${attempt}/10`);

            await page.goto('/dashboard/me');
            await page.getByRole('button', { name: 'AR Hub' }).click();
            await page.getByRole('link', { name: 'Collections' }).click();

            const collectionSearch = page.locator('.form-group').first().getByRole('textbox');

            await collectionSearch.fill(accountId);
            await page.getByRole('button', { name: 'Search' }).click();
            await page.waitForTimeout(10000);

            const viewButton = page.getByRole('button', { name: 'View' });

            if (!(await viewButton.isVisible().catch(() => false))) {
                console.log('Collection View button not found yet...');
                continue;
            }

            await viewButton.click();
            await page.waitForTimeout(2000);

            const actionCell = page.getByRole('cell', { name: expectedAction, exact: true }).last();

            if (!(await actionCell.isVisible().catch(() => false))) {
                console.log(`${expectedAction} not found yet...`);
                continue;
            }

            await actionCell.scrollIntoViewIfNeeded();

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

            const cells = actionRow.getByRole('cell');
            const nextActionDateText = await cells.nth(nextActionDateIndex).innerText();
            const nextActionDate = normalizeDate(nextActionDateText);

            console.log(`PASS: Next Action = ${expectedAction}`);
            console.log(`PASS: Next Action Date = ${nextActionDate}`);

            return {
                action: expectedAction,
                nextActionDate
            };
        }

        throw new Error(`Could not find ${expectedAction} after 10 attempts`);
    };

    // ============================================================
    // LOGIN
    // ============================================================

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('PASS: Login successful');

    // ============================================================
    // 1. FIND NEXT PENDING BILL
    // ============================================================

    const pendingBill = await getNextPendingBill();

    console.log('================================================');
    console.log(`PENDING BILL: ${pendingBill.startDate} -> ${pendingBill.endDate}`);
    console.log(`BILLING JOB DATE: ${pendingBill.jobDate}`);
    console.log('================================================');

    // ============================================================
    // 2. RUN NEXT MONTH BILLING
    // ============================================================

    await cleanJobs(pendingBill.jobDate);
    await setCcpTime(pendingBill.jobDate);
    await runBillingDailyJob(pendingBill.jobDate);

    // ============================================================
    // 3. VERIFY BILL + GET DUE DATE
    // ============================================================

    const dueDate = await getGeneratedBillDueDate(pendingBill.startDate, pendingBill.endDate);

    console.log('================================================');
    console.log(`NEW STAMPED BILL DUE DATE: ${dueDate}`);
    console.log('================================================');

    // ============================================================
    // 4. CLEAN COLLECTION JOBS BEFORE STARTING COLLECTION
    //
    // THIS IS THE ONLY COLLECTION CLEANUP
    // ============================================================

    await cleanCollectionJobs(dueDate);

    // ============================================================
    // 5. START COLLECTION ON DUE DATE
    // ============================================================

    await setCcpTime(dueDate);
    await createAndRunDailyJob(dueDate);

    // ============================================================
    // 6. FIRST REMINDER EMAIL
    // ============================================================

    const firstReminder = await getCollectionInfo('FIRST_REMINDER_EMAIL');

    console.log('================================================');
    console.log(`FIRST REMINDER DATE: ${firstReminder.nextActionDate}`);
    console.log('================================================');

    // ============================================================
    // 7. RUN FIRST REMINDER JOB CREATED BY EMBRIX
    // ============================================================

    await setCcpTime(firstReminder.nextActionDate);
    await runExistingDailyJob(firstReminder.nextActionDate);

    // ============================================================
    // 8. GET NOTIFY CANCELLATION TO CRM
    // ============================================================

    const cancellationNotification = await getCollectionInfo('NOTIFY_CANCELLATION_TO_CRM');

    console.log('================================================');
    console.log(`NOTIFY CANCELLATION DATE: ${cancellationNotification.nextActionDate}`);
    console.log('================================================');

    // ============================================================
    // 9. RUN NOTIFY CANCELLATION JOB CREATED BY EMBRIX
    // ============================================================

    await setCcpTime(cancellationNotification.nextActionDate);
    await runExistingDailyJob(cancellationNotification.nextActionDate);

    // ============================================================
    // 10. READ INACTIVATE SUBSCRIPTION
    //
    // STOP HERE.
    // DO NOT RUN THIS JOB.
    // DO NOT GENERATE ANOTHER SUSPEND ORDER.
    // ============================================================

    const suspensionAction = await getCollectionInfo('INACTIVATE_SUBSCRIPTION');

    console.log('================================================');
    console.log('NEXT ACTION IS INACTIVATE_SUBSCRIPTION');
    console.log(`SUSPENSION ACTION DATE: ${suspensionAction.nextActionDate}`);
    console.log('STOPPING BEFORE SUSPENSION');
    console.log('DO NOT RUN THE INACTIVATE_SUBSCRIPTION JOB');
    console.log('================================================');

    // ============================================================
    // SUMMARY
    // ============================================================

    console.log('================================================');
    console.log('NEXT MONTH BILLING + COLLECTION PRE-SUSPENSION PASSED');
    console.log(`Account: ${accountId}`);
    console.log(`Bill Period: ${pendingBill.startDate} -> ${pendingBill.endDate}`);
    console.log(`Billing Date: ${pendingBill.jobDate}`);
    console.log(`Invoice Due Date: ${dueDate}`);
    console.log(`First Reminder: ${firstReminder.nextActionDate}`);
    console.log(`Notify Cancellation: ${cancellationNotification.nextActionDate}`);
    console.log(`Inactivate Subscription: ${suspensionAction.nextActionDate}`);
    console.log('STATUS: STOPPED BEFORE INACTIVATE_SUBSCRIPTION');
    console.log('================================================');
});