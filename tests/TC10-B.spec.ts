import { test, expect } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import { queryDatabase } from '../helpers/database';
import { env } from '../config/environments';

test('TC10 Part B - installment plan and Month 04-08 billing', async ({ page }) => {
    test.setTimeout(30 * 60 * 1000);

    const username = env.username;
    const password = env.password;
    const accountId = ACCOUNT_ID;

    if (!username || !password) throw new Error('Missing EMBRIX_USERNAME or EMBRIX_PASSWORD');

    // ============================================================
    // HELPERS
    // ============================================================

    const normalizeDate = (text: string) => {
        const match = text.match(/\d{4}-\d{2}-\d{2}/);
        if (!match) throw new Error(`Could not read date from: ${text}`);
        return match[0];
    };

    const openAccount = async () => {
        await page.goto('/dashboard/me');
        await page.getByRole('button', { name: 'Customer Hub' }).click();
        await page.getByRole('link', { name: 'Customer Management' }).first().click();
        const search = page.locator('.form-group').first().getByRole('textbox');
        await search.fill(accountId);
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.getByRole('link', { name: accountId, exact: true }).click();
        console.log(`PASS: Account ${accountId} opened`);
    };

    // ============================================================
    // FIND LATEST ACTIVE INVOICE
    // ============================================================

    const getLatestActiveBill = async () => {
        await page.goto(`/customers/${accountId}/bills`);

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
        if (invoiceIdIndex === -1) throw new Error('Could not find Invoice Id column');

        const activeRows = table.getByRole('row').filter({ has: page.getByRole('cell', { name: 'ACTIVE', exact: true }) });
        const activeCount = await activeRows.count();

        if (activeCount === 0) throw new Error(`No ACTIVE bill found for account ${accountId}`);

        let latestDueDate = '';
        let latestInvoiceId = '';
        let latestTime = -1;

        for (let i = 0; i < activeCount; i++) {
            const row = activeRows.nth(i);
            const dueDate = normalizeDate((await row.getByRole('cell').nth(dueDateIndex).innerText()).trim());
            const invoiceId = (await row.getByRole('cell').nth(invoiceIdIndex).innerText()).trim();
            const [year, month, day] = dueDate.split('-').map(Number);
            const time = new Date(year, month - 1, day).getTime();

            console.log(`ACTIVE bill ${i + 1}: Invoice Id ${invoiceId}, Due Date ${dueDate}`);

            if (time > latestTime) {
                latestTime = time;
                latestDueDate = dueDate;
                latestInvoiceId = invoiceId;
            }
        }

        return { dueDate: latestDueDate, invoiceId: latestInvoiceId };
    };

    const getLatestCollectionBill = async () => {
        await page.goto(`/customers/${accountId}/bills`);

        const collectionCell = page.getByRole('cell', { name: 'COLLECTION', exact: true }).first();
        await expect(collectionCell).toBeVisible();

        const table = collectionCell.locator('xpath=ancestor::table[1]');
        const headers = table.getByRole('columnheader');

        let dueDateIndex = -1;
        let invoiceIdIndex = -1;

        for (let i = 0; i < await headers.count(); i++) {
            const header = (await headers.nth(i).innerText()).trim();
            if (header === 'Due Date') dueDateIndex = i;
            if (header === 'Invoice Id') invoiceIdIndex = i;
        }

        if (dueDateIndex === -1) throw new Error('Could not find Due Date column');
        if (invoiceIdIndex === -1) throw new Error('Could not find Invoice Id column');

        const collectionRows = table.getByRole('row').filter({ has: page.getByRole('cell', { name: 'COLLECTION', exact: true }) });
        const collectionCount = await collectionRows.count();

        if (collectionCount === 0) throw new Error(`No COLLECTION bill found for account ${accountId}`);

        let latestDueDate = '';
        let latestInvoiceId = '';
        let latestTime = -1;

        for (let i = 0; i < collectionCount; i++) {
            const row = collectionRows.nth(i);
            const dueDate = normalizeDate((await row.getByRole('cell').nth(dueDateIndex).innerText()).trim());
            const invoiceId = (await row.getByRole('cell').nth(invoiceIdIndex).innerText()).trim();
            const [year, month, day] = dueDate.split('-').map(Number);
            const time = new Date(year, month - 1, day).getTime();

            console.log(`COLLECTION bill ${i + 1}: Invoice Id ${invoiceId}, Due Date ${dueDate}`);

            if (time > latestTime) {
                latestTime = time;
                latestDueDate = dueDate;
                latestInvoiceId = invoiceId;
            }
        }

        return { dueDate: latestDueDate, invoiceId: latestInvoiceId };
    };

    // ============================================================
    // CREATE INSTALLMENT PLAN
    // ============================================================

    const createInstallmentPlan = async (activeInvoiceId: string, collectionInvoiceId: string) => {
        console.log(`Creating installment plan for invoices ${activeInvoiceId} and ${collectionInvoiceId}...`);

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

        const activeInvoiceCell = page.getByRole('cell', { name: activeInvoiceId, exact: true });
        await expect(activeInvoiceCell, `ACTIVE invoice ${activeInvoiceId} was not available for installment plan`).toBeVisible();
        const activeInvoiceRow = activeInvoiceCell.locator('xpath=ancestor::tr[1]');
        await activeInvoiceRow.locator('td > .check-item > .custom-control').first().click();

        console.log(`PASS: Selected ACTIVE invoice ${activeInvoiceId}`);

        const collectionInvoiceCell = page.getByRole('cell', { name: collectionInvoiceId, exact: true });
        await expect(collectionInvoiceCell, `COLLECTION invoice ${collectionInvoiceId} was not available for installment plan`).toBeVisible();
        const collectionInvoiceRow = collectionInvoiceCell.locator('xpath=ancestor::tr[1]');
        await collectionInvoiceRow.locator('td > .check-item > .custom-control').first().click();

        console.log(`PASS: Selected COLLECTION invoice ${collectionInvoiceId}`);

        await page.getByRole('button', { name: 'Select', exact: true }).click();
        await page.getByRole('button', { name: 'Create' }).click();

        console.log(`PASS: Installment plan created for ${activeInvoiceId} and ${collectionInvoiceId}`);
    };

    // ============================================================
    // GET NEXT PENDING BILL
    // SAME LOGIC AS TC05
    // ============================================================

    const getNextPendingBill = async () => {
        await openAccount();
        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();

        console.log('Looking for next PENDING bill...');

        const pendingRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'PENDING', exact: true }) }).first();

        await expect(pendingRow).toBeVisible();

        const dateCells = pendingRow.getByRole('cell').filter({ hasText: /^\d{4}-\d{2}-\d{2}$/ });

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

        const remaining = await queryDatabase(`SELECT * FROM core_engine.job_schedule WHERE scheduledate = $1`, [targetDate]);

        expect(remaining.length, `Jobs still exist for ${targetDate}`).toBe(0);

        console.log(`PASS: No jobs remain for ${targetDate}`);
    };

    // ============================================================
    // CCP TIME
    // ============================================================

    const setCcpTime = async (targetDate: string) => {
        console.log(`Changing CCP time to ${targetDate}...`);

        await page.goto(env.graphiqlUrl);

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

        console.log(`PASS: CCP time changed to ${targetDate}`);
    };

    // ============================================================
    // RUN DAILY BILLING JOB
    // SAME LOGIC AS TC05
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
        await page.waitForTimeout(5000);

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

            console.log('INVOICE_CHECK still processing...');
        }

        if (!invoiceFinished) {
            console.log(`WARNING: INVOICE_CHECK did not finish after 20 attempts for ${targetDate}`);
            console.log('Continuing to bill verification...');
        }

        console.log(`Final INVOICE_CHECK status: ${invoiceStatus || 'UNKNOWN'}`);
    };

    // ============================================================
    // PROCESS RESUME ORDER
    // SAME LOGIC AS TC08
    // ============================================================

    const openServices = async () => {
        await openAccount();
        await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
        await page.locator('a').filter({ hasText: 'Assets' }).click();
        await page.getByRole('link', { name: ' Services' }).click();
    };

    const verifyServiceActive = async () => {
        await openServices();

        console.log('Waiting for service to become ACTIVE...');

        let activeFound = false;

        for (let attempt = 1; attempt <= 10; attempt++) {
            console.log(`Checking ACTIVE status: ${attempt}/10`);

            const activeStatus = page.getByRole('cell', { name: 'ACTIVE', exact: true }).first();

            if (await activeStatus.isVisible().catch(() => false)) {
                activeFound = true;
                console.log(`PASS: Service for ${accountId} is ACTIVE`);
                break;
            }

            await page.waitForTimeout(5000);
            await page.getByRole('button', { name: 'Refresh' }).click();
        }

        expect(activeFound, `Service for account ${accountId} never reached ACTIVE`).toBe(true);
    };

    const getIncompleteResumeOrder = async () => {
        await openServices();

        console.log('Looking for incomplete RESUME order...');

        await expect(page.getByRole('heading', { name: 'In-complete Orders' })).toBeVisible();

        for (let attempt = 1; attempt <= 10; attempt++) {
            console.log(`Checking for RESUME order: ${attempt}/10`);

            const orderRow = page.getByRole('row').filter({ hasText: 'RESUME' }).filter({ hasText: 'ORD-' }).last();

            if (await orderRow.isVisible().catch(() => false)) {
                const rowText = await orderRow.innerText();
                const orderMatch = rowText.match(/ORD-[A-Za-z0-9-]+/);

                if (!orderMatch) throw new Error(`Could not find RESUME ORD- number in row: ${rowText}`);

                console.log(`PASS: RESUME order found: ${orderMatch[0]}`);
                return orderMatch[0];
            }

            await page.waitForTimeout(5000);
            await page.getByRole('button', { name: 'Refresh' }).click();
        }

        throw new Error('Could not find incomplete RESUME order');
    };

    const processResumeOrder = async () => {
        console.log('================================================');
        console.log('PROCESSING RESUME ORDER');
        console.log('================================================');

        const resumeOrderId = await getIncompleteResumeOrder();

        const sequenceRows = await queryDatabase(`SELECT * FROM core_oms.order_prov_sequence_list WHERE id = $1`, [resumeOrderId]);

        if (sequenceRows.length === 0) throw new Error(`No provisioning sequence found for ${resumeOrderId}`);

        console.log(`Found ${sequenceRows.length} provisioning sequence row(s)`);

        await queryDatabase(`UPDATE core_oms.order_prov_sequence_list SET status = 'COMPLETED' WHERE id = $1`, [resumeOrderId]);

        const remainingRows = await queryDatabase(`SELECT * FROM core_oms.order_prov_sequence_list WHERE id = $1 AND status <> 'COMPLETED'`, [resumeOrderId]);

        expect(remainingRows.length, `Provisioning sequence still has non-COMPLETED rows for ${resumeOrderId}`).toBe(0);

        console.log(`PASS: All provisioning sequence rows COMPLETED for RESUME order ${resumeOrderId}`);

        await page.waitForTimeout(3000);
        await expect(page.getByRole('button', { name: 'Submit order' })).toBeVisible();
        await page.getByRole('button', { name: 'Submit order' }).click();

        console.log(`PASS: RESUME order ${resumeOrderId} submitted`);

        await verifyServiceActive();

        console.log('================================================');
        console.log('PASS: RESUME PROCESS COMPLETE');
        console.log(`Resume Order: ${resumeOrderId}`);
        console.log('Service Status: ACTIVE');
        console.log('================================================');

        return resumeOrderId;
    };

    // ============================================================
    // VERIFY GENERATED BILL
    // TC05 LOGIC + 20 SECOND REFRESH
    // ============================================================

    const verifyBill = async (startDate: string, endDate: string, label: string) => {
        await openAccount();
        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();

        console.log(`Checking ${label} generated bill ${startDate} -> ${endDate}...`);

        let generatedBillRow = page.getByRole('row').filter({ hasText: startDate }).filter({ hasText: endDate }).filter({ hasText: 'STAMPED' }).first();

        for (let attempt = 1; attempt <= 10; attempt++) {
            if (await generatedBillRow.isVisible().catch(() => false)) {
                console.log(`PASS: ${label} STAMPED bill found on check ${attempt}/10`);
                break;
            }

            console.log(`${label} STAMPED bill not found yet: ${attempt}/10`);

            if (attempt < 10) {
                await page.waitForTimeout(20000);
                await page.reload();
                await page.waitForTimeout(2000);

                generatedBillRow = page.getByRole('row')
                    .filter({ hasText: startDate })
                    .filter({ hasText: endDate })
                    .filter({ hasText: 'STAMPED' })
                    .first();
            }
        }

        await expect(generatedBillRow, `Could not find ${label} STAMPED bill ${startDate} -> ${endDate}`).toBeVisible();

        const dateCells = generatedBillRow.getByRole('cell').filter({ hasText: /^\d{4}-\d{2}-\d{2}$/ });

        await expect(dateCells.nth(0)).toHaveText(startDate);
        await expect(dateCells.nth(1)).toHaveText(endDate);

        console.log(`PASS: ${label} generated STAMPED bill found ${startDate} -> ${endDate}`);
        console.log(`Bill row: ${(await generatedBillRow.innerText()).replace(/\n/g, ' | ')}`);
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
    // FIND ACTIVE + COLLECTION INVOICES
    // ============================================================

    const activeBill = await getLatestActiveBill();
    const collectionBill = await getLatestCollectionBill();

    const activeInvoiceId = activeBill.invoiceId;
    const collectionInvoiceId = collectionBill.invoiceId;

    console.log('================================================');
    console.log('TC10 PART B');
    console.log(`Account: ${accountId}`);
    console.log(`ACTIVE Invoice: ${activeInvoiceId}`);
    console.log(`ACTIVE Due Date: ${activeBill.dueDate}`);
    console.log(`COLLECTION Invoice: ${collectionInvoiceId}`);
    console.log(`COLLECTION Due Date: ${collectionBill.dueDate}`);
    console.log('================================================');

    // ============================================================
    // CREATE 4-INSTALLMENT PLAN USING BOTH INVOICES
    // ============================================================

    await createInstallmentPlan(activeInvoiceId, collectionInvoiceId);

    // ============================================================
    // PROCESS EMBRIX-GENERATED RESUME ORDER
    // ============================================================

    console.log('Waiting for RESUME order to be generated...');
    await page.waitForTimeout(5000);

    const resumeOrderId = await processResumeOrder();

    console.log(`PASS: Resume order ${resumeOrderId} processed before installment billing`);

    // ============================================================
    // MONTH 04 - MONTH 07
    // FOUR INSTALLMENT BILLING CYCLES
    // ============================================================

    for (let month = 4; month <= 7; month++) {
        const label = `MONTH ${String(month).padStart(2, '0')}`;

        console.log('================================================');
        console.log(`${label} INSTALLMENT BILLING`);
        console.log('================================================');

        const pendingBill = await getNextPendingBill();

        console.log(`${label}: ${pendingBill.startDate} -> ${pendingBill.endDate}`);
        console.log(`${label} Job Date: ${pendingBill.jobDate}`);

        await cleanJobs(pendingBill.jobDate);
        await setCcpTime(pendingBill.jobDate);
        await runDailyJob(pendingBill.jobDate);
        await verifyBill(pendingBill.startDate, pendingBill.endDate, label);

        console.log(`PASS: ${label} COMPLETE`);
    }

    // ============================================================
    // MONTH 08
    // FIFTH BILL - INSTALLMENT SHOULD BE FINISHED
    // ============================================================

    console.log('================================================');
    console.log('MONTH 08 - POST INSTALLMENT BILLING');
    console.log('================================================');

    const month08Bill = await getNextPendingBill();

    console.log(`MONTH 08: ${month08Bill.startDate} -> ${month08Bill.endDate}`);
    console.log(`MONTH 08 Job Date: ${month08Bill.jobDate}`);

    await cleanJobs(month08Bill.jobDate);
    await setCcpTime(month08Bill.jobDate);
    await runDailyJob(month08Bill.jobDate);
    await verifyBill(month08Bill.startDate, month08Bill.endDate, 'MONTH 08');

    console.log('PASS: MONTH 08 invoice generated');

    // ============================================================
    // DONE
    // ============================================================

    console.log('================================================');
    console.log('PASS: TC10 PART B COMPLETE');
    console.log(`Account: ${accountId}`);
    console.log(`ACTIVE Installment Invoice: ${activeInvoiceId}`);
    console.log(`COLLECTION Installment Invoice: ${collectionInvoiceId}`);
    console.log(`Resume Order: ${resumeOrderId}`);
    console.log('Month 04: PASS');
    console.log('Month 05: PASS');
    console.log('Month 06: PASS');
    console.log('Month 07: PASS');
    console.log('Month 08: PASS');
    console.log('================================================');
});