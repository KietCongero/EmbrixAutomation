import { test, expect } from '@playwright/test';
import { queryDatabase } from '../helpers/database';
import { ACCOUNT_ID } from '../test-data/testIds';

test('TC08 - billing, collections, payments, suspension and reconnection', async ({ page, request }) => {
    test.setTimeout(20 * 60 * 1000);

    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;
    const apiToken = process.env.EMBRIX_API_TOKEN;
    const accountId = ACCOUNT_ID;

    const RESUME_COLLECTION = process.env.RESUME_COLLECTION === 'true';

    const RUN_STEP = process.env.RUN_STEP ? Number(process.env.RUN_STEP) : 0;
    const BILLING_DATE = process.env.BILLING_DATE;

    const dailyJobUrl = 'https://core-ui.demo.embrix.org/jobs-management/job-schedule/CJ-12';
    const paymentUrl = 'https://crm-gateway.coopegsbx.embrix.org/applyPayment';

    if (!username || !password || !apiToken) throw new Error('Missing environment variables');
    if (!Number.isInteger(RUN_STEP) || RUN_STEP < 0 || RUN_STEP > 8) throw new Error(`Invalid RUN_STEP: ${RUN_STEP}`);
    if (BILLING_DATE && !/^\d{4}-\d{2}-\d{2}$/.test(BILLING_DATE)) throw new Error(`Invalid BILLING_DATE: ${BILLING_DATE}`);
    if (RUN_STEP !== 0 && [3, 4, 6, 7, 8].includes(RUN_STEP) && !BILLING_DATE) throw new Error(`RUN_STEP=${RUN_STEP} requires BILLING_DATE`);

    const shouldRun = (step: number) => RUN_STEP === 0 || RUN_STEP === step;

    type BillInfo = {
        startDate: string;
        endDate: string;
        jobDate: string;
        dueDate: string;
    };

    type CollectionInfo = {
        day16: string;
        firstReminderDate: string;
        nextActionDate: string;
    };

    let month03Bill: BillInfo | null = null;
    let month04Bill: BillInfo | null = null;
    let month03Collection: CollectionInfo | null = null;
    let month04Collection: CollectionInfo | null = null;

    // ============================================================
    // DATE HELPERS
    // ============================================================

    const normalizeDate = (text: string) => {
        const match = text.match(/\d{4}-\d{2}-\d{2}/);
        if (!match) throw new Error(`Could not find date in: ${text}`);
        return match[0];
    };

    const getPreviousMonthStart = (billingDate: string) => {
        const [yearText, monthText] = billingDate.split('-');

        let year = Number(yearText);
        let month = Number(monthText) - 1;

        if (month === 0) {
            month = 12;
            year--;
        }

        return `${year}-${String(month).padStart(2, '0')}-01`;
    };

    const getCollectionStartDate = (billingDate: string) => {
        const [year, month] = billingDate.split('-');
        return `${year}-${month}-16`;
    };

    // ============================================================
    // ACCOUNT
    // ============================================================

    const openAccount = async () => {
        await page.goto('https://core-ui.demo.embrix.org/dashboard/me');
        await page.getByRole('button', { name: 'Customer Hub' }).click();
        await page.getByRole('link', { name: 'Customer Management' }).first().click();

        const accountSearch = page.locator('.form-group').first().getByRole('textbox');

        await accountSearch.fill(accountId);
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await expect(page.getByRole('link', { name: accountId, exact: true })).toBeVisible();
        await page.getByRole('link', { name: accountId, exact: true }).click();

        console.log(`PASS: Account ${accountId} opened`);
    };

    const openServices = async () => {
        await openAccount();
        await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
        await page.locator('a').filter({ hasText: 'Assets' }).click();
        await page.getByRole('link', { name: ' Services' }).click();
    };

    // ============================================================
    // SERVICE STATUS
    // ============================================================

    const verifyServiceSuspended = async () => {
        await openServices();

        console.log('Checking for SUSPENDED service...');

        const suspendedStatus = page.getByRole('cell', { name: 'SUSPENDED', exact: true }).first();

        await expect(suspendedStatus, `Account ${accountId} does not have a SUSPENDED service`).toBeVisible();

        console.log(`PASS: Service for ${accountId} is SUSPENDED`);
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

    // ============================================================
    // CCP TIME
    // ============================================================

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

        await page.evaluate((query) => { const editorElement = document.querySelector('.CodeMirror'); const codeMirror = (editorElement as any)?.CodeMirror; if (!codeMirror) throw new Error('CodeMirror editor not found'); codeMirror.setValue(query); codeMirror.focus(); }, mutation);
        await page.waitForTimeout(1000);
        await page.getByRole('button', { name: 'Execute Query (Ctrl-Enter)' }).click();
        await expect(page.locator('pre').filter({ hasText: `"ccpTime": "${targetDate}"` })).toBeVisible();

        console.log(`PASS: CCP time changed to ${targetDate}`);
    };

    // ============================================================
    // JOB CLEANUP
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

    // IMPORTANT:
    // THIS IS THE ONLY COLLECTION CLEANUP.
    // WE CLEAN EVERYTHING FROM THE 16TH TO END OF MONTH
    // BEFORE COLLECTION STARTS.
    //
    // AFTER COLLECTION STARTS WE NEVER DELETE EMBRIX-GENERATED JOBS.

    const cleanCollectionJobs = async (billingDate: string) => {
        const [year, month] = billingDate.split('-').map(Number);
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

    // EMBRIX CREATED THIS JOB.
    // DO NOT DELETE IT.
    // DO NOT CREATE ANOTHER ONE.

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
    // BILLING - NEXT PENDING BILL
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
    // BILLING JOB
    // ============================================================

    const runBillingDailyJob = async (targetDate: string) => {
        console.log(`Running billing DAILY job for ${targetDate}...`);

        await page.goto('https://core-ui.demo.embrix.org/dashboard/me');
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
            console.log(`WARNING: INVOICE_CHECK did not finish for ${targetDate}`);
            console.log('Continuing to bill verification...');
        }

        console.log(`Final INVOICE_CHECK status: ${invoiceStatus || 'UNKNOWN'}`);
    };

    // ============================================================
    // GET STAMPED BILL
    // ============================================================

    const getStampedBillByBillingDate = async (billingDate: string): Promise<BillInfo> => {
        const startDate = getPreviousMonthStart(billingDate);
        const endDate = billingDate;

        await openAccount();
        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();

        console.log(`Looking for STAMPED bill ${startDate} -> ${endDate}...`);

        let billRow = page.getByRole('row').filter({ hasText: startDate }).filter({ hasText: endDate }).filter({ hasText: 'STAMPED' }).first();

        for (let attempt = 1; attempt <= 10; attempt++) {
            if (await billRow.isVisible().catch(() => false)) break;

            console.log(`STAMPED bill not found. Reloading... ${attempt}/10`);

            await page.reload();
            await page.waitForTimeout(5000);

            billRow = page.getByRole('row').filter({ hasText: startDate }).filter({ hasText: endDate }).filter({ hasText: 'STAMPED' }).first();
        }

        await expect(billRow, `Could not find STAMPED bill ${startDate} -> ${endDate}`).toBeVisible();

        const table = billRow.locator('xpath=ancestor::table[1]');
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

        const dueDateText = await billRow.getByRole('cell').nth(dueDateIndex).innerText();
        const dueDate = normalizeDate(dueDateText);

        console.log(`PASS: STAMPED bill found ${startDate} -> ${endDate}`);
        console.log(`PASS: Due Date = ${dueDate}`);

        return {
            startDate,
            endDate,
            jobDate: endDate,
            dueDate
        };
    };

    // ============================================================
    // BILLING CYCLE
    // ============================================================

    const runNextBillingCycle = async (label: string): Promise<BillInfo> => {
        console.log('================================================');
        console.log(`STARTING ${label} BILLING`);
        console.log('================================================');

        const pendingBill = await getNextPendingBill();

        console.log(`${label} pending period: ${pendingBill.startDate} -> ${pendingBill.endDate}`);
        console.log(`${label} billing job date: ${pendingBill.jobDate}`);

        await cleanJobs(pendingBill.jobDate);
        await setCcpTime(pendingBill.jobDate);
        await runBillingDailyJob(pendingBill.jobDate);

        const bill = await getStampedBillByBillingDate(pendingBill.jobDate);

        console.log('================================================');
        console.log(`PASS: ${label} BILLING COMPLETE`);
        console.log(`Period: ${bill.startDate} -> ${bill.endDate}`);
        console.log(`Due Date: ${bill.dueDate}`);
        console.log('================================================');

        return bill;
    };

    // ============================================================
    // CHECKPOINT BILL
    // ============================================================

    const recoverCheckpointBill = async (step: number): Promise<BillInfo> => {
        if (!BILLING_DATE) throw new Error(`RUN_STEP=${step} requires BILLING_DATE`);

        console.log('================================================');
        console.log(`RECOVERING CHECKPOINT FOR STEP ${step}`);
        console.log(`BILLING DATE: ${BILLING_DATE}`);
        console.log('================================================');

        return await getStampedBillByBillingDate(BILLING_DATE);
    };

    // ============================================================
    // COLLECTION
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

    const runCollection = async (billingDate: string, label: string): Promise<CollectionInfo> => {
        const day16 = getCollectionStartDate(billingDate);

        console.log('================================================');
        console.log(`STARTING ${label} COLLECTION`);
        console.log(`COLLECTION START DATE: ${day16}`);
        console.log('================================================');

        // ========================================================
        // BEFORE COLLECTION STARTS:
        // DELETE PRE-EXISTING JOBS FROM 16TH THROUGH END OF MONTH
        // ========================================================

        if (!RESUME_COLLECTION) {
            await cleanCollectionJobs(billingDate);
            await setCcpTime(day16);
            await createAndRunDailyJob(day16);
        } else {
            console.log(`RESUME: Skipping collection start job ${day16} because it already ran`);
        }

        // ========================================================
        // EMBRIX CREATED FIRST_REMINDER_EMAIL
        // DO NOT DELETE
        // DO NOT CREATE
        // ========================================================

        const firstReminder = await getCollectionInfo('FIRST_REMINDER_EMAIL');

        console.log('================================================');
        console.log(`FIRST REMINDER DATE: ${firstReminder.nextActionDate}`);
        console.log('================================================');

        await setCcpTime(firstReminder.nextActionDate);
        await runExistingDailyJob(firstReminder.nextActionDate);

        // ========================================================
        // EMBRIX CREATED NEXT COLLECTION ACTION
        // DO NOT DELETE
        // DO NOT RUN YET
        // ========================================================

        const nextAction = await getCollectionInfo('INACTIVATE_SUBSCRIPTION');

        console.log('================================================');
        console.log(`NEXT ACTION DATE: ${nextAction.nextActionDate}`);
        console.log('================================================');

        console.log(`PASS: ${label} collection completed through first reminder`);
        console.log(`PASS: Embrix-generated suspension job preserved for ${nextAction.nextActionDate}`);

        return {
            day16,
            firstReminderDate: firstReminder.nextActionDate,
            nextActionDate: nextAction.nextActionDate
        };
    };

    // ============================================================
    // PAYMENT
    // ============================================================

    const payPreviousMonthBill = async (billingDate: string) => {
        const previousMonthStart = getPreviousMonthStart(billingDate);

        console.log('================================================');
        console.log('PAYING PREVIOUS MONTH BILL');
        console.log(`Billing date: ${billingDate}`);
        console.log(`Target bill: ${previousMonthStart} -> ${billingDate}`);
        console.log('================================================');

        await openAccount();
        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: /Bills/ }).click();

        console.log(`Looking for bill row ${previousMonthStart} -> ${billingDate}...`);

        const billRow = page.getByRole('row').filter({ hasText: previousMonthStart }).filter({ hasText: billingDate }).filter({ hasText: 'STAMPED' }).first();

        await expect(billRow).toBeVisible();

        console.log(`PASS: Found bill row ${previousMonthStart} -> ${billingDate}`);

        const viewCell = billRow.getByRole('cell', { name: 'View', exact: true }).first();

        await expect(viewCell).toBeVisible();
        await viewCell.click();

        const table = page.getByRole('columnheader', { name: 'Invoice Id' }).locator('xpath=ancestor::table');
        const headers = table.locator('thead th');
        const invoiceRow = table.locator('tbody tr').first();
        const headerTexts = await headers.allInnerTexts();

        const invoiceIndex = headerTexts.findIndex(x => x.trim() === 'Invoice Id');
        const billTotalIndex = headerTexts.findIndex(x => x.trim() === 'Bill Total');

        if (invoiceIndex === -1) throw new Error('Could not find Invoice Id column');
        if (billTotalIndex === -1) throw new Error('Could not find Bill Total column');

        const invoiceId = (await invoiceRow.locator('td').nth(invoiceIndex).innerText()).trim();
        const billTotalText = (await invoiceRow.locator('td').nth(billTotalIndex).innerText()).trim();
        const billTotal = Number(billTotalText.replace(/,/g, '').replace(/[^\d.-]/g, ''));

        console.log(`Invoice ID: ${invoiceId}`);
        console.log(`Bill Total: ${billTotal}`);

        const response = await request.post(paymentUrl, {
            headers: {
                Authorization: `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
            },
            data: {
                id: '',
                paymentSourceId: '',
                paymentDate: '',
                paymentSource: 'BCR',
                allocationData: [{
                    accountId,
                    invoiceId,
                    currency: 'CRC',
                    amount: billTotal,
                }],
            },
        });

        const body = await response.json();

        console.log(body);

        expect(response.ok()).toBeTruthy();
        expect(body.status).toBe('SUCCESS');
        expect(body.statusCode).toBe('0');

        console.log(`PASS: Paid ${billTotal} CRC to invoice ${invoiceId}`);

        return {
            startDate: previousMonthStart,
            endDate: billingDate,
            invoiceId,
            billTotal
        };
    };

    // ============================================================
    // INCOMPLETE ORDER HELPERS
    // SUSPEND / RESUME
    // ============================================================

    const getIncompleteOrder = async (orderType: 'SUSPEND' | 'RESUME') => {
        await openServices();

        console.log(`Looking for incomplete ${orderType} order...`);

        await expect(page.getByRole('heading', { name: 'In-complete Orders' })).toBeVisible();

        for (let attempt = 1; attempt <= 10; attempt++) {
            console.log(`Checking for ${orderType} order: ${attempt}/10`);

            const orderRow = page.getByRole('row').filter({ hasText: orderType }).filter({ hasText: 'ORD-' }).last();

            if (await orderRow.isVisible().catch(() => false)) {
                const rowText = await orderRow.innerText();
                const orderMatch = rowText.match(/ORD-[A-Za-z0-9-]+/);

                if (!orderMatch) throw new Error(`Could not find ${orderType} ORD- number in row: ${rowText}`);

                const orderId = orderMatch[0];

                console.log(`PASS: ${orderType} order found: ${orderId}`);

                return orderId;
            }

            await page.waitForTimeout(5000);
            await page.getByRole('button', { name: 'Refresh' }).click();
        }

        throw new Error(`Could not find incomplete ${orderType} order`);
    };

    const completeOrderProvisioning = async (orderId: string, orderType: 'SUSPEND' | 'RESUME') => {
        console.log(`Checking provisioning sequence for ${orderType} order ${orderId}...`);

        const sequenceRows = await queryDatabase(`SELECT * FROM core_oms.order_prov_sequence_list WHERE id = $1`, [orderId]);

        if (sequenceRows.length === 0) throw new Error(`No provisioning sequence found for ${orderId}`);

        console.log(`Found ${sequenceRows.length} provisioning sequence row(s)`);

        await queryDatabase(`UPDATE core_oms.order_prov_sequence_list SET status = 'COMPLETED' WHERE id = $1`, [orderId]);

        const remainingRows = await queryDatabase(`SELECT * FROM core_oms.order_prov_sequence_list WHERE id = $1 AND status <> 'COMPLETED'`, [orderId]);

        expect(remainingRows.length, `Provisioning sequence still has non-COMPLETED rows for ${orderId}`).toBe(0);

        console.log(`PASS: All provisioning sequence rows COMPLETED for ${orderType} order ${orderId}`);
    };

    const submitIncompleteOrder = async (orderId: string, orderType: 'SUSPEND' | 'RESUME') => {
        console.log(`Submitting ${orderType} order ${orderId}...`);

        await page.waitForTimeout(3000);
        await expect(page.getByRole('button', { name: 'Submit order' })).toBeVisible();
        await page.getByRole('button', { name: 'Submit order' }).click();

        console.log(`PASS: ${orderType} order ${orderId} submitted`);
    };

    const processResumeOrder = async () => {
        console.log('================================================');
        console.log('PROCESSING RESUME ORDER');
        console.log('================================================');

        const resumeOrderId = await getIncompleteOrder('RESUME');

        await completeOrderProvisioning(resumeOrderId, 'RESUME');
        await submitIncompleteOrder(resumeOrderId, 'RESUME');
        await verifyServiceActive();

        console.log('================================================');
        console.log('PASS: RESUME PROCESS COMPLETE');
        console.log(`Resume Order: ${resumeOrderId}`);
        console.log('Service Status: ACTIVE');
        console.log('================================================');

        return resumeOrderId;
    };

    const processSuspendOrder = async () => {
        console.log('================================================');
        console.log('PROCESSING SUSPEND ORDER');
        console.log('================================================');

        const suspendOrderId = await getIncompleteOrder('SUSPEND');

        await completeOrderProvisioning(suspendOrderId, 'SUSPEND');
        await submitIncompleteOrder(suspendOrderId, 'SUSPEND');
        await verifyServiceSuspended();

        console.log('================================================');
        console.log('PASS: SUSPEND PROCESS COMPLETE');
        console.log(`Suspend Order: ${suspendOrderId}`);
        console.log('Service Status: SUSPENDED');
        console.log('================================================');

        return suspendOrderId;
    };

    // ============================================================
    // LOGIN
    // ============================================================

    console.log('================================================');
    console.log(RUN_STEP === 0 ? 'TC08 MODE: FULL RUN' : `TC08 MODE: STEP ${RUN_STEP} ONLY`);
    if (BILLING_DATE) console.log(`BILLING DATE: ${BILLING_DATE}`);
    if (RESUME_COLLECTION) console.log('RESUME COLLECTION: TRUE');
    console.log('================================================');

    await page.goto('https://core-ui.demo.embrix.org/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('PASS: Login successful');

    // ============================================================
    // STEP 1
    // VERIFY TC07 END STATE
    // ============================================================

    if (shouldRun(1)) {
        await test.step('1 - Verify TC07 suspended state', async () => {
            await verifyServiceSuspended();

            console.log('================================================');
            console.log('PASS: TC07 END STATE CONFIRMED');
            console.log(`Account: ${accountId}`);
            console.log('Service: SUSPENDED');
            console.log('================================================');
        });
    }

    // ============================================================
    // STEP 2
    // MONTH 03 BILLING
    // GENERATES MONTH 02 INVOICE
    // ============================================================

    if (shouldRun(2)) {
        await test.step('2 - Run Month 03 billing', async () => {
            month03Bill = await runNextBillingCycle('MONTH 03');
        });
    }

    // ============================================================
    // STEP 3
    // MONTH 03 COLLECTION
    //
    // CLEAN 16TH -> END OF MONTH BEFORE STARTING
    // RUN COLLECTION CREATE
    // RUN EMBRIX-GENERATED FIRST REMINDER
    // PRESERVE EMBRIX-GENERATED NEXT ACTION
    // ============================================================

    if (shouldRun(3)) {
        await test.step('3 - Run Month 03 collection', async () => {
            if (!month03Bill) month03Bill = await recoverCheckpointBill(3);

            month03Collection = await runCollection(month03Bill.jobDate, 'MONTH 03');

            console.log('================================================');
            console.log(`MONTH 03 COLLECTION START: ${month03Collection.day16}`);
            console.log(`MONTH 03 FIRST REMINDER: ${month03Collection.firstReminderDate}`);
            console.log(`MONTH 03 NEXT ACTION: ${month03Collection.nextActionDate}`);
            console.log('================================================');
        });
    }

    // ============================================================
    // STEP 4
    // PAY MONTH 02
    //
    // TC08 EXPECTATION:
    // SERVICE REMAINS SUSPENDED
    // ============================================================

    if (shouldRun(4)) {
        await test.step('4 - Pay Month 02 and verify still suspended', async () => {
            if (!month03Bill) month03Bill = await recoverCheckpointBill(4);

            const month02Payment = await payPreviousMonthBill(month03Bill.jobDate);

            await verifyServiceSuspended();

            console.log('================================================');
            console.log('PASS: MONTH 02 INVOICE PAID');
            console.log(`Invoice: ${month02Payment.invoiceId}`);
            console.log('PASS: Service remained SUSPENDED');
            console.log('================================================');
        });
    }

    // ============================================================
    // STEP 5
    // MONTH 04 BILLING
    // MONTH 03 INVOICE STILL UNPAID
    // ============================================================

    if (shouldRun(5)) {
        await test.step('5 - Run Month 04 billing', async () => {
            month04Bill = await runNextBillingCycle('MONTH 04');
        });
    }

    // ============================================================
    // STEP 6
    // PAY MONTH 03
    //
    // PAYMENT GENERATES RESUME ORDER
    // MANUALLY COMPLETE RESUME PROVISIONING
    // SUBMIT RESUME ORDER
    // VERIFY ACTIVE
    // ============================================================

    if (shouldRun(6)) {
        await test.step('6 - Pay Month 03 and reconnect service', async () => {
            if (!month04Bill) month04Bill = await recoverCheckpointBill(6);

            const month03Payment = await payPreviousMonthBill(month04Bill.jobDate);

            console.log('Waiting for RESUME order to be generated...');

            await page.waitForTimeout(5000);

            const resumeOrderId = await processResumeOrder();

            console.log('================================================');
            console.log('PASS: MONTH 03 INVOICE PAID');
            console.log(`Invoice: ${month03Payment.invoiceId}`);
            console.log(`Resume Order: ${resumeOrderId}`);
            console.log('PASS: Service reconnected and is ACTIVE');
            console.log('================================================');
        });
    }

    // ============================================================
    // STEP 7
    // MONTH 04 COLLECTION
    //
    // SERVICE IS ACTIVE
    //
    // CLEAN ONLY BEFORE COLLECTION START
    // AFTER THAT PRESERVE EMBRIX-GENERATED JOBS
    // ============================================================

    if (shouldRun(7)) {
        await test.step('7 - Run Month 04 collection', async () => {
            if (!month04Bill) month04Bill = await recoverCheckpointBill(7);

            month04Collection = await runCollection(month04Bill.jobDate, 'MONTH 04');

            console.log('================================================');
            console.log(`MONTH 04 COLLECTION START: ${month04Collection.day16}`);
            console.log(`MONTH 04 FIRST REMINDER: ${month04Collection.firstReminderDate}`);
            console.log(`MONTH 04 SUSPENSION ACTION: ${month04Collection.nextActionDate}`);
            console.log('================================================');
        });
    }

    // ============================================================
    // STEP 8
    // RUN EMBRIX-GENERATED SUSPENSION JOB
    //
    // DO NOT DELETE / RECREATE JOB
    //
    // THEN PROCESS GENERATED SUSPEND ORDER
    // ============================================================

    if (shouldRun(8)) {
        await test.step('8 - Run suspension action and suspend service', async () => {
            if (!month04Bill) month04Bill = await recoverCheckpointBill(8);

            let suspensionDate = '';

            if (month04Collection) {
                suspensionDate = month04Collection.nextActionDate;
            } else {
                const suspensionAction = await getCollectionInfo('INACTIVATE_SUBSCRIPTION');
                suspensionDate = suspensionAction.nextActionDate;
            }

            console.log('================================================');
            console.log(`SUSPENSION ACTION DATE: ${suspensionDate}`);
            console.log('================================================');

            // EMBRIX CREATED THIS JOB.
            // DO NOT DELETE OR CREATE.

            await setCcpTime(suspensionDate);
            await runExistingDailyJob(suspensionDate);

            console.log('Waiting for SUSPEND order to be generated...');

            await page.waitForTimeout(5000);

            const suspendOrderId = await processSuspendOrder();

            console.log('================================================');
            console.log('PASS: STEP 8 COMPLETE');
            console.log(`Suspension Date: ${suspensionDate}`);
            console.log(`Suspend Order: ${suspendOrderId}`);
            console.log('Service Status: SUSPENDED');
            console.log('================================================');
        });
    }
});