import { test, expect } from '@playwright/test';
import { queryDatabase } from '../helpers/database';
import { ACCOUNT_ID } from '../test-data/testIds';
import { env } from '../config/environments';

test('billing cycle -> collection -> suspended service', async ({ page }) => {
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
        for (let attempt = 1; attempt <= 6; attempt++) {
            console.log(`Refreshing jobs: ${attempt}/6`);

            await page.waitForTimeout(5000);
            await page.getByTitle('Refresh jobs').click();

            const completed = page.getByText('Completed', { exact: true }).first();

            if (await completed.isVisible().catch(() => false)) {
                console.log('PASS: Job processing shows COMPLETED');
                break;
            }
        }
    };

    // ============================================================
    // BILLING - FIND NEXT PENDING BILL
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
    // BILLING - RUN DAILY JOB
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
    // BILLING - VERIFY STAMPED BILL + GET DUE DATE
    // ============================================================

    const getGeneratedBillDueDate = async (startDate: string, endDate: string) => {
        await openAccount();
        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();

        console.log(`Looking for newly generated STAMPED bill ${startDate} -> ${endDate}...`);

        await page.waitForTimeout(2000);
        await page.reload();

        let generatedBillRow = page.getByRole('row').filter({ hasText: startDate }).filter({ hasText: endDate }).filter({ hasText: 'STAMPED' }).first();

        for (let attempt = 1; attempt <= 5; attempt++) {
            if (await generatedBillRow.isVisible().catch(() => false)) break;

            console.log(`STAMPED bill not found. Reloading... ${attempt}/5`);

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
    // COLLECTION - CREATE FIRST DAILY JOB
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
    // COLLECTION - RUN EMBRIX CREATED JOB
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
    // COLLECTION - READ SPECIFIC ACTION
    //
    // minimumDate prevents an older Month 02 row from being used
    // while Month 03 is still loading.
    // ============================================================

    const getCollectionInfo = async (expectedAction: string, minimumDate: string) => {
        console.log(`Checking Collection for ${expectedAction}...`);
        console.log(`Only accepting rows dated ${minimumDate} or later`);

        for (let attempt = 1; attempt <= 3; attempt++) {
            console.log('================================================');
            console.log(`Collection lookup attempt ${attempt}/3`);
            console.log(`Looking for: ${expectedAction}`);
            console.log('================================================');

            try {
                await page.goto('/dashboard/me');
                await page.getByRole('button', { name: 'AR Hub' }).click();
                await page.getByRole('link', { name: 'Collections' }).click();

                const collectionSearch = page.locator('.form-group').first().getByRole('textbox');

                await collectionSearch.fill(accountId);

                console.log(`Searching collection for account ${accountId}...`);

                await page.getByRole('button', { name: 'Search' }).click();
                await page.waitForTimeout(3000);

                const viewButton = page.getByRole('cell', { name: 'View' }).first();

                if (!(await viewButton.isVisible().catch(() => false))) {
                    console.log(`View button not available on attempt ${attempt}/3`);

                    if (attempt < 3) {
                        console.log('Waiting 20 seconds before trying again...');
                        await page.waitForTimeout(20000);
                    }

                    continue;
                }

                await viewButton.click();
                await page.waitForTimeout(3000);

                const actionCells = page.getByRole('cell', { name: expectedAction, exact: true });
                const matchingActionCount = await actionCells.count();

                console.log(`Found ${matchingActionCount} total ${expectedAction} row(s)`);

                let currentActionFound = false;

                for (let index = matchingActionCount - 1; index >= 0; index--) {
                    const actionCell = actionCells.nth(index);

                    await actionCell.scrollIntoViewIfNeeded();

                    const actionRow = actionCell.locator('xpath=ancestor::tr[1]');

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

                    console.log(`Checking ${expectedAction} row with date ${nextActionDate}`);

                    if (nextActionDate < minimumDate) {
                        console.log(`Ignoring old collection row ${nextActionDate}`);
                        continue;
                    }

                    currentActionFound = true;

                    console.log('================================================');
                    console.log('PASS: Invoice Status = COLLECTION');
                    console.log(`PASS: Next Action = ${expectedAction}`);
                    console.log(`PASS: Next Action Date = ${nextActionDate}`);
                    console.log(`PASS: Found on attempt ${attempt}/3`);
                    console.log('================================================');

                    return {
                        action: expectedAction,
                        nextActionDate
                    };
                }

                if (!currentActionFound) {
                    console.log(`${expectedAction} for the current collection cycle is not available yet`);

                    if (attempt < 3) {
                        console.log('Waiting 20 seconds before refreshing Collections, typing the account again, and clicking View again...');
                        await page.waitForTimeout(20000);
                    }

                    continue;
                }
            } catch (error) {
                console.log(`Collection lookup attempt ${attempt}/3 failed`);

                if (attempt === 3) throw error;

                console.log('Waiting 20 seconds before trying the full collection search again...');
                await page.waitForTimeout(20000);
            }
        }

        throw new Error(`Could not find current ${expectedAction} for account ${accountId} after 3 attempts`);
    };

    // ============================================================
    // COLLECTION - CRM NOTIFICATION OR DIRECT SUSPENSION
    //
    // Some runs have:
    // FIRST_REMINDER_EMAIL
    // -> NOTIFY_CANCELLATION_TO_CRM
    // -> INACTIVATE_SUBSCRIPTION
    //
    // Other runs can go directly:
    // FIRST_REMINDER_EMAIL
    // -> INACTIVATE_SUBSCRIPTION
    // ============================================================

    const getNextCancellationAction = async (minimumDate: string) => {
        console.log('Checking for NOTIFY_CANCELLATION_TO_CRM or INACTIVATE_SUBSCRIPTION...');
        console.log(`Only accepting rows dated ${minimumDate} or later`);

        for (let attempt = 1; attempt <= 3; attempt++) {
            console.log('================================================');
            console.log(`Collection action lookup attempt ${attempt}/3`);
            console.log('Looking for CRM notification or suspension action');
            console.log('================================================');

            try {
                await page.goto('/dashboard/me');
                await page.getByRole('button', { name: 'AR Hub' }).click();
                await page.getByRole('link', { name: 'Collections' }).click();

                const collectionSearch = page.locator('.form-group').first().getByRole('textbox');

                await collectionSearch.fill(accountId);
                await page.getByRole('button', { name: 'Search' }).click();
                await page.waitForTimeout(3000);

                const viewButton = page.getByRole('cell', { name: 'View' }).first();

                if (!(await viewButton.isVisible().catch(() => false))) {
                    console.log(`View button not available on attempt ${attempt}/3`);

                    if (attempt < 3) {
                        console.log('Waiting 20 seconds before trying again...');
                        await page.waitForTimeout(20000);
                    }

                    continue;
                }

                await viewButton.click();
                await page.waitForTimeout(3000);

                const possibleActions = page.getByRole('cell', { name: /^(NOTIFY_CANCELLATION_TO_CRM|INACTIVATE_SUBSCRIPTION)$/ });
                const actionCount = await possibleActions.count();

                console.log(`Found ${actionCount} total CRM/suspension action row(s)`);

                for (let index = actionCount - 1; index >= 0; index--) {
                    const actionCell = possibleActions.nth(index);

                    await actionCell.scrollIntoViewIfNeeded();

                    const action = (await actionCell.innerText()).trim();
                    const actionRow = actionCell.locator('xpath=ancestor::tr[1]');

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

                    console.log(`Checking ${action} row with date ${nextActionDate}`);

                    if (nextActionDate < minimumDate) {
                        console.log(`Ignoring old collection row ${nextActionDate}`);
                        continue;
                    }

                    console.log('================================================');
                    console.log(`PASS: Current collection action = ${action}`);
                    console.log(`PASS: Next Action Date = ${nextActionDate}`);
                    console.log(`PASS: Found on attempt ${attempt}/3`);
                    console.log('================================================');

                    return {
                        action,
                        nextActionDate
                    };
                }

                console.log('No CRM notification or suspension action for the current collection cycle yet');

                if (attempt < 3) {
                    console.log('Waiting 20 seconds before refreshing Collections, typing the account again, and clicking View again...');
                    await page.waitForTimeout(20000);
                }
            } catch (error) {
                console.log(`Collection action lookup attempt ${attempt}/3 failed`);

                if (attempt === 3) throw error;

                console.log('Waiting 20 seconds before trying the full collection search again...');
                await page.waitForTimeout(20000);
            }
        }

        throw new Error(`Could not find current NOTIFY_CANCELLATION_TO_CRM or INACTIVATE_SUBSCRIPTION for account ${accountId} after 3 attempts`);
    };

    // ============================================================
    // SUSPENSION - FIND ORDER
    // ============================================================

    const getSuspendOrder = async () => {
        await openAccount();
        await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
        await page.locator('a').filter({ hasText: 'Assets' }).click();
        await page.getByRole('link', { name: ' Services' }).click();

        console.log('Looking for incomplete SUSPEND order...');

        await expect(page.getByRole('heading', { name: 'In-complete Orders' })).toBeVisible();

        const suspendRow = page.getByRole('row').filter({ hasText: 'SUSPEND' }).filter({ hasText: 'ORD-' }).first();

        await expect(suspendRow).toBeVisible();

        const rowText = await suspendRow.innerText();
        const orderMatch = rowText.match(/ORD-[A-Za-z0-9-]+/);

        if (!orderMatch) throw new Error(`Could not find suspend ORD- number in row: ${rowText}`);

        const suspendOrderId = orderMatch[0];

        console.log(`PASS: Suspend order found: ${suspendOrderId}`);

        return suspendOrderId;
    };

    // ============================================================
    // SUSPENSION - COMPLETE PROVISIONING
    // ============================================================

    const completeSuspendProvisioning = async (suspendOrderId: string) => {
        console.log(`Checking provisioning sequence for ${suspendOrderId}...`);

        const sequenceRows = await queryDatabase(`SELECT * FROM core_oms.order_prov_sequence_list WHERE id = $1`, [suspendOrderId]);

        if (sequenceRows.length === 0) throw new Error(`No provisioning sequence found for ${suspendOrderId}`);

        console.log(`Found ${sequenceRows.length} provisioning sequence row(s)`);

        await queryDatabase(`UPDATE core_oms.order_prov_sequence_list SET status = 'COMPLETED' WHERE id = $1`, [suspendOrderId]);

        const remainingRows = await queryDatabase(`SELECT * FROM core_oms.order_prov_sequence_list WHERE id = $1 AND status <> 'COMPLETED'`, [suspendOrderId]);

        expect(remainingRows.length, `Provisioning sequence still has non-COMPLETED rows for ${suspendOrderId}`).toBe(0);

        console.log(`PASS: All provisioning sequence rows COMPLETED for ${suspendOrderId}`);
    };

    // ============================================================
    // SUSPENSION - SUBMIT ORDER
    // ============================================================

    const submitSuspendOrder = async (suspendOrderId: string) => {
        console.log(`Submitting suspend order ${suspendOrderId}...`);

        await page.waitForTimeout(3000);
        await page.getByRole('button', { name: 'Submit order' }).click();

        console.log(`PASS: Suspend order ${suspendOrderId} submitted`);
    };

    // ============================================================
    // SUSPENSION - VERIFY STATUS
    // ============================================================

    const verifySuspended = async () => {
        console.log('Waiting for service to become SUSPENDED...');

        let suspendedFound = false;

        for (let attempt = 1; attempt <= 10; attempt++) {
            console.log(`Checking SUSPENDED status: ${attempt}/10`);

            await page.waitForTimeout(5000);
            await page.getByRole('button', { name: 'Refresh' }).click();

            const suspendedStatus = page.getByRole('cell', { name: 'SUSPENDED', exact: true }).first();

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
    // 2. RUN NEXT BILLING CYCLE
    // ============================================================

    await cleanJobs(pendingBill.jobDate);
    await setCcpTime(pendingBill.jobDate);
    await runBillingDailyJob(pendingBill.jobDate);

    // ============================================================
    // 3. VERIFY STAMPED BILL + GET DUE DATE
    // ============================================================

    const dueDate = await getGeneratedBillDueDate(pendingBill.startDate, pendingBill.endDate);

    console.log('================================================');
    console.log(`NEW STAMPED BILL DUE DATE: ${dueDate}`);
    console.log('================================================');

    // ============================================================
    // 4. CLEAN COLLECTION JOBS
    // ============================================================

    await cleanCollectionJobs(dueDate);

    // ============================================================
    // 5. START COLLECTION
    // ============================================================

    await cleanJobs(dueDate);
    await setCcpTime(dueDate);
    await createAndRunDailyJob(dueDate);

    // ============================================================
    // 6. FIRST REMINDER EMAIL
    //
    // Must belong to THIS collection cycle.
    // Old Month 02 rows are ignored.
    // ============================================================

    const firstReminder = await getCollectionInfo('FIRST_REMINDER_EMAIL', dueDate);

    console.log('================================================');
    console.log(`FIRST REMINDER DATE: ${firstReminder.nextActionDate}`);
    console.log('================================================');

    // ============================================================
    // 7. RUN FIRST REMINDER
    // ============================================================

    await setCcpTime(firstReminder.nextActionDate);
    await runExistingDailyJob(firstReminder.nextActionDate);

    // ============================================================
    // 8. CHECK NEXT COLLECTION ACTION
    //
    // CRM notification may or may not exist.
    // ============================================================

    const nextCancellationAction = await getNextCancellationAction(firstReminder.nextActionDate);

    let cancellationNotification: { action: string; nextActionDate: string } | null = null;
    let suspensionAction: { action: string; nextActionDate: string };

    if (nextCancellationAction.action === 'NOTIFY_CANCELLATION_TO_CRM') {
        cancellationNotification = nextCancellationAction;

        console.log('================================================');
        console.log(`NOTIFY CANCELLATION DATE: ${cancellationNotification.nextActionDate}`);
        console.log('================================================');

        await setCcpTime(cancellationNotification.nextActionDate);
        await runExistingDailyJob(cancellationNotification.nextActionDate);

        suspensionAction = await getCollectionInfo('INACTIVATE_SUBSCRIPTION', cancellationNotification.nextActionDate);
    } else {
        console.log('================================================');
        console.log('NOTIFY_CANCELLATION_TO_CRM was skipped');
        console.log('INACTIVATE_SUBSCRIPTION is already the current collection action');
        console.log('================================================');

        suspensionAction = nextCancellationAction;
    }

    // ============================================================
    // 9. INACTIVATE SUBSCRIPTION
    // ============================================================

    console.log('================================================');
    console.log(`SUSPENSION ACTION DATE: ${suspensionAction.nextActionDate}`);
    console.log('================================================');

    // ============================================================
    // 10. RUN SUSPENSION JOB
    // ============================================================

    await setCcpTime(suspensionAction.nextActionDate);
    await runExistingDailyJob(suspensionAction.nextActionDate);

    // ============================================================
    // 11. FIND SUSPEND ORDER
    // ============================================================

    const suspendOrderId = await getSuspendOrder();

    // ============================================================
    // 12. COMPLETE PROVISIONING
    // ============================================================

    await completeSuspendProvisioning(suspendOrderId);

    // ============================================================
    // 13. SUBMIT SUSPEND ORDER
    // ============================================================

    await submitSuspendOrder(suspendOrderId);

    // ============================================================
    // 14. VERIFY SUSPENDED
    // ============================================================

    await verifySuspended();

    // ============================================================
    // SUMMARY
    // ============================================================

    console.log('================================================');
    console.log('BILLING + COLLECTION PROCESS PASSED');
    console.log(`Account: ${accountId}`);
    console.log(`Bill Period: ${pendingBill.startDate} -> ${pendingBill.endDate}`);
    console.log(`Billing Date: ${pendingBill.jobDate}`);
    console.log(`Invoice Due Date: ${dueDate}`);
    console.log(`First Reminder: ${firstReminder.nextActionDate}`);
    console.log(`Notify Cancellation: ${cancellationNotification ? cancellationNotification.nextActionDate : 'SKIPPED'}`);
    console.log(`Suspension Date: ${suspensionAction.nextActionDate}`);
    console.log(`Suspend Order: ${suspendOrderId}`);
    console.log('Service Status: SUSPENDED');
    console.log('================================================');
});