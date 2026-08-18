import { test, expect } from '@playwright/test';
import { queryDatabase } from '../helpers/database';
import { ACCOUNT_ID } from '../test-data/testIds';

test('run two recurring billing cycles and verify invoices', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;
    const accountId = ACCOUNT_ID;

    if (!username || !password) throw new Error('Missing username or password');

    const addMonths = (date: string, months: number) => {
        const [year, month, day] = date.split('-').map(Number);
        return new Date(Date.UTC(year, month - 1 + months, day)).toISOString().slice(0, 10);
    };

    const openAccount = async () => {
        await page.goto('https://core-ui.demo.embrix.org/dashboard/me');
        await page.getByRole('button', { name: 'Customer Hub' }).click();
        await page.getByRole('link', { name: 'Customer Management' }).first().click();

        const accountSearch = page.locator('.form-group').first().getByRole('textbox');
        await accountSearch.fill(accountId);
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.getByRole('link', { name: accountId, exact: true }).click();
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

        await expect(
            page.locator('pre').filter({ hasText: `"ccpTime": "${targetDate}"` })
        ).toBeVisible();

        console.log(`PASS: CCP time changed to ${targetDate}`);
    };

    const runDailyJob = async (targetDate: string) => {
        console.log(`Running DAILY jobs for ${targetDate}...`);

        await page.goto('https://core-ui.demo.embrix.org/dashboard/me');
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

        let invoiceErrorFound = false;

        for (let attempt = 1; attempt <= 20; attempt++) {
            console.log(`Checking INVOICE_CHECK ${targetDate}: ${attempt}/20`);

            await page.getByTitle('Refresh jobs').click();
            await page.waitForTimeout(15000);

            const invoiceCheck = page.getByRole('heading', { name: 'INVOICE_CHECK' });

            if (!(await invoiceCheck.isVisible().catch(() => false))) {
                console.log('INVOICE_CHECK not visible yet...');
                continue;
            }

            const invoiceError = page.getByTitle('Status: ERROR');

            if (await invoiceError.isVisible().catch(() => false)) {
                console.log(`PASS: INVOICE_CHECK reached ERROR for ${targetDate}`);
                invoiceErrorFound = true;
                break;
            }

            console.log('INVOICE_CHECK has not reached ERROR yet...');
        }

        if (!invoiceErrorFound) {
            console.log(`WARNING: INVOICE_CHECK did not reach ERROR after 20 attempts for ${targetDate}`);
            console.log('Continuing to billing verification in case the invoice was already generated...');
        }
    };

    const verifyBills = async (
        previousStartDate: string,
        previousEndDate: string,
        pendingStartDate: string,
        pendingEndDate: string,
        viewIndex: number
    ) => {
        await openAccount();

        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();

        console.log(`Checking pending bill ${pendingStartDate} -> ${pendingEndDate}...`);

        const pendingBillRow = page
            .getByRole('row')
            .filter({ hasText: pendingStartDate })
            .filter({ hasText: pendingEndDate })
            .first();

        await expect(pendingBillRow).toBeVisible();
        await expect(pendingBillRow.getByRole('cell', { name: pendingStartDate })).toBeVisible();
        await expect(pendingBillRow.getByRole('cell', { name: pendingEndDate })).toBeVisible();

        console.log(`PASS: Pending bill found ${pendingStartDate} -> ${pendingEndDate}`);

        console.log(`Checking generated invoice ${previousStartDate} -> ${previousEndDate}...`);

        const previousBillRow = page
            .getByRole('row')
            .filter({ hasText: previousStartDate })
            .filter({ hasText: previousEndDate })
            .first();

        await expect(previousBillRow).toBeVisible();
        await expect(previousBillRow.getByRole('cell', { name: previousStartDate })).toBeVisible();
        await expect(previousBillRow.getByRole('cell', { name: previousEndDate })).toBeVisible();

        console.log(`PASS: Generated invoice found ${previousStartDate} -> ${previousEndDate}`);

        const viewCell = page.getByRole('cell', { name: 'View' }).nth(viewIndex);

        await expect(viewCell).toBeVisible();
        await viewCell.click();

        console.log(`PASS: Opened invoice ${previousStartDate} -> ${previousEndDate}`);

        await page.getByRole('button', { name: '   Invoice Lines' }).click();

        const invoiceDialog = page.getByRole('dialog');

        await expect(invoiceDialog).toBeVisible();
        await expect(invoiceDialog.getByRole('cell', { name: previousStartDate })).toBeVisible();
        await expect(invoiceDialog.getByRole('cell', { name: previousEndDate })).toBeVisible();

        console.log(`PASS: Invoice line covers ${previousStartDate} -> ${previousEndDate}`);

        await page.getByRole('button', { name: 'Cancel' }).click();
    };

    // LOGIN
    await page.goto('https://core-ui.demo.embrix.org/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('PASS: Login successful');

    // GET EFFECTIVE DATE
    await openAccount();

    await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
    await page.locator('a').filter({ hasText: 'Assets' }).click();
    await page.getByRole('link', { name: ' Services' }).click();

    const activeRow = page
        .getByRole('row')
        .filter({ has: page.getByRole('cell', { name: 'ACTIVE', exact: true }) })
        .first();

    await expect(activeRow).toBeVisible();

    const rowText = await activeRow.innerText();
    const dateMatches = rowText.match(/\d{4}-\d{2}-\d{2}/g);

    if (!dateMatches || dateMatches.length === 0) {
        throw new Error(`Could not find effective date in row: ${rowText}`);
    }

    const effectiveDate = dateMatches[0];
    const month1Date = addMonths(effectiveDate, 1);
    const month2Date = addMonths(effectiveDate, 2);
    const month3Date = addMonths(effectiveDate, 3);

    console.log('========================================');
    console.log(`Effective date: ${effectiveDate}`);
    console.log(`Month 1:        ${month1Date}`);
    console.log(`Month 2:        ${month2Date}`);
    console.log(`Month 3:        ${month3Date}`);
    console.log('========================================');

    // CLEAN MONTH 1 + MONTH 2 JOBS
    for (const scheduledDate of [month1Date, month2Date]) {
        console.log(`Cleaning jobs for ${scheduledDate}...`);

        const jobs = await queryDatabase(`
            SELECT *
            FROM core_engine.job_schedule
            WHERE scheduledate = $1
        `, [scheduledDate]);

        console.log(`Found ${jobs.length} job(s) for ${scheduledDate}`);

        for (const job of jobs) {
            const jobId = job.id;

            await queryDatabase(`
                DELETE FROM core_engine.job_schedule_list
                WHERE id = $1
            `, [jobId]);

            await queryDatabase(`
                DELETE FROM core_engine.job_schedule
                WHERE id = $1
            `, [jobId]);

            console.log(`PASS: Deleted job ${jobId}`);
        }

        const remainingJobs = await queryDatabase(`
            SELECT *
            FROM core_engine.job_schedule
            WHERE scheduledate = $1
        `, [scheduledDate]);

        expect(remainingJobs.length, `Jobs still exist for ${scheduledDate}`).toBe(0);

        console.log(`PASS: No jobs remain for ${scheduledDate}`);
    }

    // MONTH 1
    console.log('========================================');
    console.log('MONTH 1 BILLING');
    console.log('========================================');

    await setCcpTime(month1Date);
    await runDailyJob(month1Date);

    await verifyBills(
        effectiveDate,
        month1Date,
        month1Date,
        month2Date,
        1
    );

    console.log('PASS: MONTH 1 BILLING VERIFIED');

    // MONTH 2
    console.log('========================================');
    console.log('MONTH 2 BILLING');
    console.log('========================================');

    await setCcpTime(month2Date);
    await runDailyJob(month2Date);

    await verifyBills(
        month1Date,
        month2Date,
        month2Date,
        month3Date,
        5
    );

    console.log('PASS: MONTH 2 BILLING VERIFIED');

    console.log('========================================');
    console.log('TWO BILLING CYCLES PASSED');
    console.log('========================================');
});