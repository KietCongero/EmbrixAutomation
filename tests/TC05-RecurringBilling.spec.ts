import { test, expect } from '@playwright/test';
import { queryDatabase } from '../helpers/database';
import { ACCOUNT_ID } from '../test-data/testIds';
import { env } from '../config/environments';

test('run next pending billing cycle and verify generated bill', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const username = env.username;
    const password = env.password;
    const accountId = ACCOUNT_ID;

    if (!username || !password) throw new Error('Missing username or password');

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
    // GET NEXT PENDING BILL
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

        return { startDate, endDate, jobDate: endDate };
    };

    // ============================================================
    // CLEAN JOBS
    // ============================================================

    const cleanJobs = async (targetDate: string) => {
        console.log(`Cleaning jobs for ${targetDate}...`);

        const jobs = await queryDatabase(`SELECT * FROM core_engine.job_schedule WHERE scheduledate = $1`, [targetDate]);

        console.log(`Found ${jobs.length} job(s) for ${targetDate}`);

        for (const job of jobs) {
            await queryDatabase(`DELETE FROM core_engine.job_schedule_list WHERE id = $1`, [job.id]);
            await queryDatabase(`DELETE FROM core_engine.job_schedule WHERE id = $1`, [job.id]);

            console.log(`PASS: Deleted job ${job.id}`);
        }

        const remainingJobs = await queryDatabase(`SELECT * FROM core_engine.job_schedule WHERE scheduledate = $1`, [targetDate]);

        expect(remainingJobs.length, `Jobs still exist for ${targetDate}`).toBe(0);

        console.log(`PASS: No jobs remain for ${targetDate}`);
    };

    // ============================================================
    // SET CCP TIME
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
    // RUN DAILY BILLING JOB
    // ============================================================

    const runDailyJob = async (targetDate: string) => {
        console.log(`Running DAILY jobs for ${targetDate}...`);

        await page.goto('/dashboard/me');
        await page.getByRole('button', { name: 'Operations Hub' }).click();
        await page.getByRole('link', { name: 'Jobs Management' }).click();
        await page.locator('#sidebarnav a').filter({ hasText: 'Jobs Management' }).click();
        await page.getByRole('link', { name: ' DAILY' }).click();

        const dateInput = page.getByRole('textbox').first();

        await dateInput.click();
        await dateInput.press('ControlOrMeta+a');
        await dateInput.fill(targetDate);
        await dateInput.press('Escape');

        console.log(`Target date selected: ${targetDate}`);

        await page.getByRole('button', { name: 'Create Job Schedule' }).click();

        console.log(`PASS: Job schedule created for ${targetDate}`);

        await page.getByTitle('Refresh jobs').click();
        await page.waitForTimeout(2000);

        await page.getByRole('button', { name: 'Process' }).click();
        await page.getByRole('button', { name: 'Yes' }).click();

        console.log(`PASS: Started DAILY processing for ${targetDate}`);

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

                console.log(`PASS: INVOICE_CHECK reached COMPLETED for ${targetDate}`);
                break;
            }

            if (await invoiceError.isVisible().catch(() => false)) {
                invoiceStatus = 'ERROR';
                invoiceFinished = true;

                console.log(`WARNING: INVOICE_CHECK reached ERROR for ${targetDate}`);
                break;
            }

            console.log('INVOICE_CHECK is still processing...');
        }

        if (!invoiceFinished) {
            console.log(`WARNING: INVOICE_CHECK did not finish after 20 attempts for ${targetDate}`);
            console.log('Continuing to bill verification...');
        }

        console.log(`Final INVOICE_CHECK status: ${invoiceStatus || 'UNKNOWN'}`);
    };

    // ============================================================
    // VERIFY GENERATED BILL
    // ============================================================

    const verifyBill = async (startDate: string, endDate: string) => {
        await openAccount();

        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();

        console.log(`Checking generated bill ${startDate} -> ${endDate}...`);

        let generatedBillRow = page.getByRole('row').filter({ hasText: startDate }).filter({ hasText: endDate }).filter({ hasText: 'STAMPED' }).first();

        for (let attempt = 1; attempt <= 10; attempt++) {
            if (await generatedBillRow.isVisible().catch(() => false)) break;

            console.log(`STAMPED bill not found yet: ${attempt}/10`);

            await page.reload();
            await page.waitForTimeout(5000);

            generatedBillRow = page.getByRole('row').filter({ hasText: startDate }).filter({ hasText: endDate }).filter({ hasText: 'STAMPED' }).first();
        }

        await expect(generatedBillRow, `Could not find STAMPED bill ${startDate} -> ${endDate}`).toBeVisible();

        const generatedDateCells = generatedBillRow.getByRole('cell').filter({ hasText: /^\d{4}-\d{2}-\d{2}$/ });

        await expect(generatedDateCells.nth(0)).toHaveText(startDate);
        await expect(generatedDateCells.nth(1)).toHaveText(endDate);

        console.log(`PASS: Generated STAMPED bill found ${startDate} -> ${endDate}`);
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
    // 1. GET NEXT PENDING BILL
    // ============================================================

    const pendingBill = await getNextPendingBill();

    console.log('================================================');
    console.log(`Pending Bill: ${pendingBill.startDate} -> ${pendingBill.endDate}`);
    console.log(`Billing Job Date: ${pendingBill.jobDate}`);
    console.log('================================================');

    // ============================================================
    // 2. CLEAN EXISTING JOBS
    // ============================================================

    await cleanJobs(pendingBill.jobDate);

    // ============================================================
    // 3. MOVE CCP TIME
    // ============================================================

    await setCcpTime(pendingBill.jobDate);

    // ============================================================
    // 4. RUN BILLING
    // ============================================================

    await runDailyJob(pendingBill.jobDate);

    // ============================================================
    // 5. VERIFY BILL
    // ============================================================

    await verifyBill(pendingBill.startDate, pendingBill.endDate);

    // ============================================================
    // DONE
    // ============================================================

    console.log('================================================');
    console.log('PASS: BILLING CYCLE VERIFIED');
    console.log(`Account: ${accountId}`);
    console.log(`Bill Period: ${pendingBill.startDate} -> ${pendingBill.endDate}`);
    console.log(`Billing Job Date: ${pendingBill.jobDate}`);
    console.log('================================================');
});