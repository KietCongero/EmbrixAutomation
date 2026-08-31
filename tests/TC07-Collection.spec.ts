import { test, expect } from '@playwright/test';
import { queryDatabase } from '../helpers/database';
import { ACCOUNT_ID } from '../test-data/testIds';

test('collection process - bill to suspended service', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;
    const accountId = ACCOUNT_ID;
    const dailyJobUrl = 'https://core-ui.demo.embrix.org/jobs-management/job-schedule/CJ-12';

    if (!username || !password) throw new Error('Missing username or password');

    const normalizeDate = (text: string) => {
        const match = text.match(/\d{4}-\d{2}-\d{2}/);
        if (!match) throw new Error(`Could not find date in: ${text}`);
        return match[0];
    };

    const openAccount = async () => {
        await page.goto('https://core-ui.demo.embrix.org/dashboard/me');
        await page.getByRole('button', { name: 'Customer Hub' }).click();
        await page.getByRole('link', { name: 'Customer Management' }).first().click();

        const accountSearch = page.locator('.form-group').first().getByRole('textbox');

        await accountSearch.fill(accountId);
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.getByRole('link', { name: accountId, exact: true }).click();

        console.log(`PASS: Account ${accountId} opened`);
    };

    const setCcpTime = async (targetDate: string) => {
        console.log(`Changing CCP time to ${targetDate}...`);

        await page.goto('https://transactional.coopeg.embrix.org/graphiql?');

        const mutation = `mutation {
  setCcpTime(input: {
    ccpTime: "${targetDate}"
  })
  {
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

    const cleanJobs = async (targetDate: string) => {
        console.log(`Cleaning jobs for ${targetDate}...`);

        const jobs = await queryDatabase(`
            SELECT *
            FROM core_engine.job_schedule
            WHERE scheduledate = $1
        `, [targetDate]);

        console.log(`Found ${jobs.length} existing job(s)`);

        for (const job of jobs) {
            await queryDatabase(`
                DELETE FROM core_engine.job_schedule_list
                WHERE id = $1
            `, [job.id]);

            await queryDatabase(`
                DELETE FROM core_engine.job_schedule
                WHERE id = $1
            `, [job.id]);

            console.log(`PASS: Deleted job ${job.id}`);
        }

        const remainingJobs = await queryDatabase(`
            SELECT *
            FROM core_engine.job_schedule
            WHERE scheduledate = $1
        `, [targetDate]);

        expect(remainingJobs.length, `Jobs still exist for ${targetDate}`).toBe(0);

        console.log(`PASS: Jobs cleaned for ${targetDate}`);
    };

    const cleanCollectionJobs = async (referenceDate: string) => {
        const [year, month] = referenceDate.split('-');
        const collectionDays = [16, 17, 21, 22];

        console.log('================================================');
        console.log(`Cleaning collection jobs for ${year}-${month}`);
        console.log('================================================');

        for (const day of collectionDays) {
            const targetDate = `${year}-${month}-${String(day).padStart(2, '0')}`;
            await cleanJobs(targetDate);
        }

        console.log(`PASS: Collection jobs cleaned for ${year}-${month}`);
    };

    const fillJobDate = async (targetDate: string) => {
        const dateInput = page.getByRole('textbox').first();

        await dateInput.click();
        await dateInput.press('ControlOrMeta+a');
        await dateInput.fill(targetDate);
        await dateInput.press('Escape');

        console.log(`Job date selected: ${targetDate}`);
    };

    const waitAfterJobRun = async () => {
        for (let attempt = 1; attempt <= 6; attempt++) {
            console.log(`Refreshing jobs: ${attempt}/6`);

            await page.waitForTimeout(5000);
            await page.getByTitle('Refresh jobs').click();

            const completed = page.getByText('Completed', { exact: true }).first();

            if (await completed.isVisible().catch(() => false)) {
                console.log('Job processing shows COMPLETED');
                break;
            }
        }
    };

    const createAndRunDailyJob = async (targetDate: string) => {
        console.log(`Creating DAILY job for ${targetDate}...`);

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

    const runExistingDailyJob = async (targetDate: string) => {
        console.log(`Running existing DAILY job for ${targetDate}...`);

        await page.goto(dailyJobUrl);
        await fillJobDate(targetDate);

        // DO NOT DELETE OR CREATE - EMBRIX CREATED THIS JOB
        await page.getByTitle('Refresh jobs').click();
        await page.waitForTimeout(5000);

        await expect(page.getByRole('button', { name: 'Process' })).toBeVisible();

        await page.getByRole('button', { name: 'Process' }).click();
        await page.getByRole('button', { name: 'Yes' }).click();

        console.log(`PASS: Existing job processing started for ${targetDate}`);

        await waitAfterJobRun();
    };

    const getInvoiceDueDate = async () => {
        await openAccount();

        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();

        console.log('Looking for generated ACTIVE / STAMPED bill...');

        const generatedBillRow = page
            .getByRole('row')
            .filter({ hasText: 'ACTIVE' })
            .filter({ hasText: 'STAMPED' })
            .first();

        await expect(generatedBillRow).toBeVisible();

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

        console.log(`PASS: Invoice due date = ${dueDate}`);

        return dueDate;
    };

    const getCollectionInfo = async (expectedAction: string) => {
        console.log(`Checking Collection for ${expectedAction}...`);

        await page.goto('https://core-ui.demo.embrix.org/dashboard/me');
        await page.getByRole('button', { name: 'AR Hub' }).click();
        await page.getByRole('link', { name: 'Collections' }).click();

        const collectionSearch = page.locator('.form-group').first().getByRole('textbox');

        await collectionSearch.fill(accountId);

        let found = false;

        for (let attempt = 1; attempt <= 10; attempt++) {
            console.log(`Collection search attempt ${attempt}/10`);

            await page.getByRole('button', { name: 'Search' }).click();
            await page.waitForTimeout(15000);

            if (await page.getByRole('cell', { name: 'View' }).first().isVisible().catch(() => false)) {
                await page.getByRole('cell', { name: 'View' }).first().click();
                found = true;
                break;
            }
        }

        if (!found) throw new Error(`Could not find collection for account ${accountId} after 10 searches`);

        await expect(page.getByRole('cell', { name: 'COLLECTION', exact: true }).first()).toBeVisible();
        await expect(page.getByRole('cell', { name: expectedAction, exact: true }).first()).toBeVisible();

        const actionRow = page
            .getByRole('row')
            .filter({ has: page.getByRole('cell', { name: expectedAction, exact: true }) })
            .first();

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

        console.log('PASS: Invoice Status = COLLECTION');
        console.log(`PASS: Next Action = ${expectedAction}`);
        console.log(`PASS: Next Action Date = ${nextActionDate}`);

        return {
            action: expectedAction,
            nextActionDate
        };
    };

    const getSuspendOrder = async () => {
        await openAccount();

        await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
        await page.locator('a').filter({ hasText: 'Assets' }).click();
        await page.getByRole('link', { name: ' Services' }).click();

        console.log('Looking for incomplete SUSPEND order...');

        await expect(page.getByRole('heading', { name: 'In-complete Orders' })).toBeVisible();

        const suspendRow = page
            .getByRole('row')
            .filter({ hasText: 'SUSPEND' })
            .filter({ hasText: 'ORD-' })
            .first();

        await expect(suspendRow).toBeVisible();

        const rowText = await suspendRow.innerText();
        const orderMatch = rowText.match(/ORD-[A-Za-z0-9-]+/);

        if (!orderMatch) throw new Error(`Could not find suspend ORD- number in row: ${rowText}`);

        const suspendOrderId = orderMatch[0];

        console.log(`PASS: Suspend order found: ${suspendOrderId}`);

        return suspendOrderId;
    };

    const completeSuspendProvisioning = async (suspendOrderId: string) => {
        console.log(`Checking provisioning sequence for ${suspendOrderId}...`);

        const sequenceRows = await queryDatabase(`
            SELECT *
            FROM core_oms.order_prov_sequence_list
            WHERE id = $1
        `, [suspendOrderId]);

        if (sequenceRows.length === 0) throw new Error(`No provisioning sequence found for ${suspendOrderId}`);

        console.log(`Found ${sequenceRows.length} provisioning sequence row(s)`);

        await queryDatabase(`
            UPDATE core_oms.order_prov_sequence_list
            SET status = 'COMPLETED'
            WHERE id = $1
        `, [suspendOrderId]);

        const remainingRows = await queryDatabase(`
            SELECT *
            FROM core_oms.order_prov_sequence_list
            WHERE id = $1
              AND status <> 'COMPLETED'
        `, [suspendOrderId]);

        expect(remainingRows.length, `Provisioning sequence still has non-COMPLETED rows for ${suspendOrderId}`).toBe(0);

        console.log(`PASS: All provisioning sequence rows COMPLETED for ${suspendOrderId}`);
    };

    const submitSuspendOrder = async (suspendOrderId: string) => {
        console.log(`Submitting suspend order ${suspendOrderId}...`);

        await page.waitForTimeout(3000);
        await page.getByRole('button', { name: 'Submit order' }).click();

        console.log(`PASS: Suspend order ${suspendOrderId} submitted`);
    };

    const verifySuspended = async () => {
        console.log('Waiting for service to become SUSPENDED...');

        let suspendedFound = false;

        for (let attempt = 1; attempt <= 10; attempt++) {
            console.log(`Checking SUSPENDED status: ${attempt}/10`);

            await page.waitForTimeout(5000);
            await page.getByRole('button', { name: 'Refresh' }).click();

            const suspendedStatus = page.getByRole('cell', {
                name: 'SUSPENDED',
                exact: true
            }).first();

            if (await suspendedStatus.isVisible().catch(() => false)) {
                suspendedFound = true;
                console.log(`PASS: Service for ${accountId} is SUSPENDED`);
                break;
            }
        }

        expect(suspendedFound, `Service for account ${accountId} never reached SUSPENDED`).toBe(true);
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
    // 1. GET DUE DATE FROM BILL THAT WAS JUST CREATED
    // ============================================================

    const dueDate = await getInvoiceDueDate();

    console.log('================================================');
    console.log(`INVOICE DUE DATE: ${dueDate}`);
    console.log('================================================');

    // ============================================================
    // 2. CLEAN COLLECTION JOBS FOR THIS MONTH
    // DELETE 16TH, 17TH, 21ST, 22ND
    // ============================================================

    await cleanCollectionJobs(dueDate);

    // ============================================================
    // 3. DUE DATE - DELETE JOBS, CREATE NEW JOB, PROCESS
    // ============================================================

    await cleanJobs(dueDate);
    await setCcpTime(dueDate);
    await createAndRunDailyJob(dueDate);

    // ============================================================
    // 4. COLLECTION - FIRST REMINDER EMAIL
    // ============================================================

    const firstReminder = await getCollectionInfo('FIRST_REMINDER_EMAIL');

    console.log('================================================');
    console.log(`FIRST REMINDER DATE: ${firstReminder.nextActionDate}`);
    console.log('================================================');

    // ============================================================
    // 5. FIRST REMINDER DATE
    // JOB CREATED BY EMBRIX - DO NOT DELETE / CREATE
    // ============================================================

    await setCcpTime(firstReminder.nextActionDate);
    await runExistingDailyJob(firstReminder.nextActionDate);

    // ============================================================
    // 6. COLLECTION - INACTIVATE SUBSCRIPTION
    // ============================================================

    const suspensionAction = await getCollectionInfo('INACTIVATE_SUBSCRIPTION');

    console.log('================================================');
    console.log(`SUSPENSION ACTION DATE: ${suspensionAction.nextActionDate}`);
    console.log('================================================');

    // ============================================================
    // 7. SUSPENSION ACTION DATE
    // JOB CREATED BY EMBRIX - DO NOT DELETE / CREATE
    // ============================================================

    await setCcpTime(suspensionAction.nextActionDate);
    await runExistingDailyJob(suspensionAction.nextActionDate);

    // ============================================================
    // 8. FIND NEW INCOMPLETE SUSPEND ORDER
    // ============================================================

    const suspendOrderId = await getSuspendOrder();

    // ============================================================
    // 9. MANUALLY COMPLETE PROVISIONING SEQUENCE
    // ============================================================

    await completeSuspendProvisioning(suspendOrderId);

    // ============================================================
    // 10. SUBMIT SUSPEND ORDER
    // ============================================================

    await submitSuspendOrder(suspendOrderId);

    // ============================================================
    // 11. VERIFY SERVICE IS SUSPENDED
    // ============================================================

    await verifySuspended();

    console.log('================================================');
    console.log('COLLECTION PROCESS PASSED');
    console.log(`Account: ${accountId}`);
    console.log(`Invoice Due Date: ${dueDate}`);
    console.log(`First Reminder: ${firstReminder.nextActionDate}`);
    console.log(`Suspension Date: ${suspensionAction.nextActionDate}`);
    console.log(`Suspend Order: ${suspendOrderId}`);
    console.log('Service Status: SUSPENDED');
    console.log('================================================');
});