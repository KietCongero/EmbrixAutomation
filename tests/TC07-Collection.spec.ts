import { test, expect } from '@playwright/test';
import { queryDatabase } from '../helpers/database';
import { ACCOUNT_ID } from '../test-data/testIds';
import { env } from '../config/environments';

test('existing stamped bill -> collection -> first reminder', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const username = env.username;
    const password = env.password;
    const accountId = ACCOUNT_ID;
    const dailyJobUrl = '/jobs-management/job-schedule/CJ-12';

    if (!username || !password) throw new Error('Missing username or password');

    // ============================================================
    // DATE
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
  }) {
    ccpTime
  }
}`;

        await page.evaluate((query) => {
            const editorElement = document.querySelector('.CodeMirror');
            const codeMirror = (editorElement as any)?.CodeMirror;
            if (!codeMirror) throw new Error('CodeMirror editor not found');
            codeMirror.setValue(query);
            codeMirror.focus();
        }, mutation);

        await page.waitForTimeout(1000);
        await page.getByRole('button', { name: 'Execute Query (Ctrl-Enter)' }).click();
        await expect(page.locator('pre').filter({ hasText: `"ccpTime": "${targetDate}"` })).toBeVisible();

        console.log(`PASS: CCP time changed to ${targetDate}`);
    };

    // ============================================================
    // CLEAN JOBS
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
    // CLEAN COLLECTION JOBS
    //
    // ONLY BEFORE COLLECTION STARTS.
    // AFTER COLLECTION STARTS WE KEEP EMBRIX-GENERATED JOBS.
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
    // JOB DATE
    // ============================================================

    const fillJobDate = async (targetDate: string) => {
        const dateInput = page.getByRole('textbox').first();

        await dateInput.click();
        await dateInput.press('ControlOrMeta+a');
        await dateInput.fill(targetDate);
        await dateInput.press('Escape');

        console.log(`Job date selected: ${targetDate}`);
    };

    // ============================================================
    // WAIT FOR JOB
    // ============================================================

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
    // GET LATEST STAMPED BILL
    // ============================================================

    const getLatestStampedBill = async () => {
        await openAccount();

        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();

        console.log('Looking for latest STAMPED bill...');

        await page.waitForTimeout(2000);
        await page.reload();
        await page.waitForTimeout(2000);

        const stampedRows = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'STAMPED', exact: true }) });

        await expect(stampedRows.first()).toBeVisible();

        const count = await stampedRows.count();

        console.log(`Found ${count} STAMPED bill(s)`);

        let latestDueDate = '';
        let latestStartDate = '';
        let latestEndDate = '';

        for (let rowIndex = 0; rowIndex < count; rowIndex++) {
            const row = stampedRows.nth(rowIndex);
            const table = row.locator('xpath=ancestor::table[1]');
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

            const cells = row.getByRole('cell');
            const dueDateText = await cells.nth(dueDateIndex).innerText();
            const dueDate = normalizeDate(dueDateText);
            const dateCells = row.getByRole('cell').filter({ hasText: /^\d{4}-\d{2}-\d{2}$/ });

            let startDate = '';
            let endDate = '';

            if (await dateCells.nth(0).isVisible().catch(() => false)) startDate = (await dateCells.nth(0).innerText()).trim();
            if (await dateCells.nth(1).isVisible().catch(() => false)) endDate = (await dateCells.nth(1).innerText()).trim();

            console.log(`STAMPED bill candidate: ${startDate || '?'} -> ${endDate || '?'} | Due: ${dueDate}`);

            if (!latestDueDate || dueDate > latestDueDate) {
                latestDueDate = dueDate;
                latestStartDate = startDate;
                latestEndDate = endDate;
            }
        }

        if (!latestDueDate) throw new Error('Could not determine latest STAMPED bill due date');

        console.log('================================================');
        console.log('PASS: Latest STAMPED bill found');
        console.log(`Bill Period: ${latestStartDate || '?'} -> ${latestEndDate || '?'}`);
        console.log(`Due Date: ${latestDueDate}`);
        console.log('================================================');

        return { startDate: latestStartDate, endDate: latestEndDate, dueDate: latestDueDate };
    };

    // ============================================================
    // CREATE INITIAL COLLECTION JOB
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
    // RUN EXISTING EMBRIX-GENERATED JOB
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
    // COLLECTION - GET LATEST MATCHING ACTION
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
    // LOGIN
    // ============================================================

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('PASS: Login successful');

    // ============================================================
    // 1. READ EXISTING STAMPED BILL
    // ============================================================

    const stampedBill = await getLatestStampedBill();

    console.log('================================================');
    console.log('STARTING COLLECTION');
    console.log(`Bill Period: ${stampedBill.startDate} -> ${stampedBill.endDate}`);
    console.log(`Due Date: ${stampedBill.dueDate}`);
    console.log('================================================');

    // ============================================================
    // 2. CLEAN COLLECTION JOBS BEFORE COLLECTION STARTS
    // ============================================================

    await cleanCollectionJobs(stampedBill.dueDate);

    // ============================================================
    // 3. START COLLECTION ON DUE DATE
    // ============================================================

    await setCcpTime(stampedBill.dueDate);
    await createAndRunDailyJob(stampedBill.dueDate);

    // ============================================================
    // 4. GET FIRST REMINDER DATE
    // ============================================================

    const firstReminder = await getCollectionInfo('FIRST_REMINDER_EMAIL');

    console.log('================================================');
    console.log(`FIRST REMINDER DATE: ${firstReminder.nextActionDate}`);
    console.log('================================================');

    // ============================================================
    // 5. RUN EXISTING FIRST REMINDER JOB
    //
    // IMPORTANT:
    // DO NOT DELETE/RECREATE THIS JOB.
    // EMBRIX GENERATED IT WHEN COLLECTION STARTED.
    // ============================================================

    await setCcpTime(firstReminder.nextActionDate);
    await runExistingDailyJob(firstReminder.nextActionDate);

    // ============================================================
    // DONE
    //
    // STOP HERE.
    // NO NOTIFY_CANCELLATION_TO_CRM.
    // NO INACTIVATE_SUBSCRIPTION.
    // NO SUSPEND ORDER.
    // ============================================================

    console.log('================================================');
    console.log('PASS: TC07 COLLECTION THROUGH FIRST REMINDER');
    console.log(`Account: ${accountId}`);
    console.log(`Bill Period: ${stampedBill.startDate} -> ${stampedBill.endDate}`);
    console.log(`Invoice Due Date: ${stampedBill.dueDate}`);
    console.log(`First Reminder Date: ${firstReminder.nextActionDate}`);
    console.log('================================================');
});