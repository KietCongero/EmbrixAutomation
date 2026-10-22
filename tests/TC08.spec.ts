import { test, expect } from '@playwright/test';
import { queryDatabase } from '../helpers/database';
import { ACCOUNT_ID } from '../test-data/testIds';
test('TC08 - billing, collections, payments, suspension and reconnection', async ({ page, request }) => {
    test.setTimeout(40 * 60 * 1000);
    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;
    const apiToken = process.env.EMBRIX_API_TOKEN;
    const accountId = ACCOUNT_ID;
    const RUN_STEP = process.env.RUN_STEP ? Number(process.env.RUN_STEP) : 0;
    const BILLING_DATE = process.env.BILLING_DATE;
    const RESUME_COLLECTION = process.env.RESUME_COLLECTION === 'true';
    const dailyJobUrl = 'https://core-ui.demo.embrix.org/jobs-management/job-schedule/CJ-12';
    const paymentUrl = 'https://crm-gateway.coopegsbx.embrix.org/applyPayment';
    if (!username || !password || !apiToken) throw new Error('Missing environment variables');
    if (!Number.isInteger(RUN_STEP) || RUN_STEP < 0 || RUN_STEP > 15) throw new Error(`Invalid RUN_STEP: ${RUN_STEP}`);
    const shouldRun = (step: number) => RUN_STEP === 0 || RUN_STEP === step;
    type BillInfo = {
        startDate: string;
        endDate: string;
        jobDate: string;
        dueDate: string;
    };
    type InvoiceInfo = {
        invoiceId: string;
        startDate: string;
        endDate: string;
        status: string;
        folioStatus: string;
        due: number;
    };
    let month03Bill: BillInfo | null = null;
    let month04Bill: BillInfo | null = null;
    let month05Bill: BillInfo | null = null;
    let month03SuspensionDate = '';
    let month05OriginalSuspensionDate = process.env.ORIGINAL_SUSPENSION_DATE || '';
    // ============================================================
    // DATE HELPERS
    // ============================================================
    const normalizeDate = (text: string) => {
        const match = text.match(/\d{4}-\d{2}-\d{2}/);
        if (!match) throw new Error(`Could not find date in: ${text}`);
        return match[0];
    };
    const getPreviousMonthStart = (date: string) => {
        const [year, month] = date.split('-').map(Number);
        const previous = new Date(Date.UTC(year, month - 2, 1));
        return previous.toISOString().slice(0, 10);
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
    const verifyServiceStatus = async (expectedStatus: 'ACTIVE' | 'SUSPENDED') => {
        await openServices();
        console.log(`Checking for ${expectedStatus} service...`);
        for (let attempt = 1; attempt <= 10; attempt++) {
            const status = page.getByRole('cell', { name: expectedStatus, exact: true }).first();
            if (await status.isVisible().catch(() => false)) {
                console.log(`PASS: Service for ${accountId} is ${expectedStatus}`);
                return;
            }
            await page.waitForTimeout(5000);
            await page.getByRole('button', { name: 'Refresh' }).click();
        }
        throw new Error(`Service ${accountId} did not reach ${expectedStatus}`);
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
        expect(remainingJobs.length).toBe(0);
    };
    const cleanCollectionJobs = async (dueDate: string) => {
        const [year, month, startDay] = dueDate.split('-').map(Number);
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        console.log(`Cleaning collection jobs from ${dueDate} through end of month`);
        for (let day = startDay; day <= lastDay; day++) {
            const targetDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            await cleanJobs(targetDate);
        }
        console.log('PASS: Collection jobs cleaned before collection creation');
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
        console.log(`PASS: Processing started for ${targetDate}`);
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
        await waitAfterJobRun();
    };
    // ============================================================
    // BILLING
    // ============================================================
    const getNextPendingBill = async () => {
        await page.goto(`https://core-ui.demo.embrix.org/customers/${accountId}/bills`);
        console.log('Looking for next PENDING bill...');
        const pendingBillRow = page.getByRole('row').filter({
            has: page.getByRole('cell', { name: 'PENDING', exact: true })
        }).first();
        await expect(pendingBillRow).toBeVisible();
        const dateCells = pendingBillRow.getByRole('cell').filter({ hasText: /^\d{4}-\d{2}-\d{2}$/ });
        const startDate = (await dateCells.nth(0).innerText()).trim();
        const endDate = (await dateCells.nth(1).innerText()).trim();
        console.log(`PASS: Next pending bill ${startDate} -> ${endDate}`);
        return { startDate, endDate, jobDate: endDate };
    };
    const runBillingDailyJob = async (targetDate: string) => {
        console.log(`Running billing DAILY job for ${targetDate}...`);
        await page.goto('https://core-ui.demo.embrix.org/dashboard/me');
        await page.getByRole('button', { name: 'Operations Hub' }).click();
        await page.getByRole('link', { name: 'Jobs Management' }).click();
        await page.locator('#sidebarnav a').filter({ hasText: 'Jobs Management' }).click();
        await page.getByRole('link', { name: ' DAILY' }).click();
        await fillJobDate(targetDate);
        await page.getByRole('button', { name: 'Create Job Schedule' }).click();
        await page.getByTitle('Refresh jobs').click();
        await page.waitForTimeout(2000);
        await page.getByRole('button', { name: 'Process' }).click();
        await page.getByRole('button', { name: 'Yes' }).click();
        console.log(`PASS: Billing processing started for ${targetDate}`);
        await page.waitForTimeout(15000);
        let invoiceStatus = 'UNKNOWN';
        for (let attempt = 1; attempt <= 20; attempt++) {
            console.log(`Checking INVOICE_CHECK ${targetDate}: ${attempt}/20`);
            await page.getByTitle('Refresh jobs').click();
            await page.waitForTimeout(15000);
            const invoiceCheck = page.getByRole('heading', { name: 'INVOICE_CHECK' });
            if (!(await invoiceCheck.isVisible().catch(() => false))) continue;
            if (await page.getByTitle('Status: COMPLETED').isVisible().catch(() => false)) {
                invoiceStatus = 'COMPLETED';
                break;
            }
            if (await page.getByTitle('Status: ERROR').isVisible().catch(() => false)) {
                invoiceStatus = 'ERROR';
                break;
            }
        }
        console.log(`Final INVOICE_CHECK status: ${invoiceStatus}`);
        if (invoiceStatus === 'ERROR') {
            console.log('WARNING: INVOICE_CHECK reported ERROR. Verifying whether the invoice was generated...');
        }
    };
    const getStampedBillByPeriod = async (startDate: string, endDate: string): Promise<BillInfo> => {
        await page.goto(`https://core-ui.demo.embrix.org/customers/${accountId}/bills`);
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
        const values = (await billRow.getByRole('cell').allInnerTexts()).map(value => value.trim());
        if (values.length !== 26) throw new Error(`Unexpected stamped invoice column count: ${values.length}`);
        if (values[3] !== startDate || values[4] !== endDate || values[11] !== 'STAMPED') {
            throw new Error(`Incorrect stamped invoice period or folio status for ${startDate} -> ${endDate}`);
        }
        const dueDate = normalizeDate(values[15]);
        console.log(`PASS: STAMPED bill found ${startDate} -> ${endDate}`);
        console.log(`PASS: Due Date = ${dueDate}`);
        return { startDate, endDate, jobDate: endDate, dueDate };
    };
    const runNextBillingCycle = async (label: string): Promise<BillInfo> => {
        console.log('================================================');
        console.log(`STARTING ${label} BILLING`);
        console.log('================================================');
        const pendingBill = await getNextPendingBill();
        console.log(`Billing period: ${pendingBill.startDate} -> ${pendingBill.endDate}`);
        console.log(`Billing job date: ${pendingBill.jobDate}`);
        await cleanJobs(pendingBill.jobDate);
        await setCcpTime(pendingBill.jobDate);
        await runBillingDailyJob(pendingBill.jobDate);
        const bill = await getStampedBillByPeriod(pendingBill.startDate, pendingBill.endDate);
        console.log(`PASS: ${label} BILLING COMPLETE`);
        console.log(`Period: ${bill.startDate} -> ${bill.endDate}`);
        console.log(`Due Date: ${bill.dueDate}`);
        return bill;
    };
    // ============================================================
    // COLLECTION - CURRENT ACTION
    // ============================================================
    const getCollectionInfo = async (minimumDate: string) => {
        const [year, month] = minimumDate.split('-').map(Number);
        const lastDay = String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0');
        const maximumDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
        for (let attempt = 1; attempt <= 10; attempt++) {
            console.log(`Collection search ${attempt}/10: ${minimumDate} -> ${maximumDate}`);
            await page.goto('https://core-ui.demo.embrix.org/dashboard/me');
            await page.getByRole('button', { name: 'AR Hub' }).click();
            await page.getByRole('link', { name: 'Collections' }).click();
            const collectionSearch = page.locator('.form-group').first().getByRole('textbox');
            await collectionSearch.fill(accountId);
            await page.getByRole('button', { name: 'Search' }).click();
            await page.waitForTimeout(3000);
            const viewCell = page.getByRole('cell', { name: 'View', exact: true }).first();
            if (!(await viewCell.isVisible().catch(() => false))) {
                console.log('Collection View cell not found yet...');
                continue;
            }
            await viewCell.click();
            await page.waitForTimeout(2000);
            const actionCells = page.getByRole('cell', { name: /^(FIRST_REMINDER_EMAIL|INACTIVATE_SUBSCRIPTION)$/ });
            for (let index = (await actionCells.count()) - 1; index >= 0; index--) {
                const actionCell = actionCells.nth(index);
                const action = (await actionCell.innerText()).trim();
                const actionRow = actionCell.locator('xpath=ancestor::tr[1]');
                const table = actionRow.locator('xpath=ancestor::table[1]');
                const headers = await table.getByRole('columnheader').allInnerTexts();
                const dateIndex = headers.findIndex(text => text.trim() === 'Next Action Date');
                if (dateIndex === -1) throw new Error('Could not find Next Action Date column');
                const nextActionDate = normalizeDate(await actionRow.getByRole('cell').nth(dateIndex).innerText());
                if (nextActionDate < minimumDate || nextActionDate > maximumDate) continue;
                console.log(`PASS: Current collection action = ${action} on ${nextActionDate}`);
                return { action, nextActionDate };
            }
            console.log('No matching collection action yet...');
            if (attempt < 10) await page.waitForTimeout(5000);
        }
        throw new Error(`Could not find collection action from ${minimumDate} through ${maximumDate}`);
    };
    // ============================================================
    // COLLECTION - THROUGH FIRST REMINDER ONLY
    // ============================================================
    const runCollection = async (bill: BillInfo, label: string) => {
        const dueDate = bill.dueDate;
        console.log('================================================');
        console.log(`STARTING ${label} COLLECTION`);
        console.log(`Bill period: ${bill.startDate} -> ${bill.endDate}`);
        console.log(`Collection date: ${dueDate}`);
        console.log('================================================');
        if (!RESUME_COLLECTION) {
            await cleanCollectionJobs(dueDate);
            await setCcpTime(dueDate);
            await createAndRunDailyJob(dueDate);
        } else {
            console.log(`RESUME: Collection Create already ran for ${dueDate}`);
        }
        const firstAction = await getCollectionInfo(dueDate);
        if (firstAction.action === 'FIRST_REMINDER_EMAIL') {
            console.log(`FIRST REMINDER DATE: ${firstAction.nextActionDate}`);
            await setCcpTime(firstAction.nextActionDate);
            await runExistingDailyJob(firstAction.nextActionDate);
        } else {
            console.log(`FIRST_REMINDER_EMAIL already passed. Current action: ${firstAction.action}`);
        }
        const nextAction = await getCollectionInfo(dueDate);
        if (nextAction.action !== 'INACTIVATE_SUBSCRIPTION') {
            throw new Error(`${label} collection did not advance to INACTIVATE_SUBSCRIPTION`);
        }
        console.log(`PASS: ${label} collection completed through FIRST_REMINDER_EMAIL`);
        console.log(`Next action: ${nextAction.action} on ${nextAction.nextActionDate}`);
        console.log('Scheduled suspension is pending. No suspension job run in this step.');
        return nextAction;
    };
    // ============================================================
    // BILL PAYMENT - READ ACTUAL INVOICE TABLE
    // ============================================================
    const openBills = async () => {
        await page.goto(`https://core-ui.demo.embrix.org/customers/${accountId}/bills`);
        await expect(page.getByRole('row').filter({ hasText: 'STAMPED' }).first()).toBeVisible();
    };
    const readInvoices = async (): Promise<InvoiceInfo[]> => {
        const rows = page.getByRole('row');
        const invoices: InvoiceInfo[] = [];
        for (let i = 0; i < await rows.count(); i++) {
            const values = (await rows.nth(i).getByRole('cell').allInnerTexts()).map(value => value.trim());
            if (values.length !== 26) continue;
            const invoiceId = values[8];
            const due = Number(values[14].replace(/,/g, '').replace(/[^\d.-]/g, ''));
            if (!invoiceId) continue;
            invoices.push({
                invoiceId,
                startDate: values[3],
                endDate: values[4],
                status: values[10],
                folioStatus: values[11],
                due
            });
        }
        return invoices;
    };
    // ============================================================
    // PAY OLDEST OUTSTANDING INVOICE AND VERIFY CLOSED
    // ============================================================
    const payBill = async (expectedStartDate: string, expectedEndDate: string) => {
        console.log('================================================');
        console.log('PAYING OLDEST OUTSTANDING INVOICE');
        console.log(`Billing reference: ${expectedStartDate} -> ${expectedEndDate}`);
        console.log('================================================');
        await openBills();
        const invoicesBefore = await readInvoices();
        console.log('================================================');
        console.log('INVOICES BEFORE PAYMENT');
        console.log('================================================');
        for (const invoice of invoicesBefore) {
            console.log(`${invoice.invoiceId} | ${invoice.startDate} -> ${invoice.endDate} | ${invoice.status} | Due: ${invoice.due}`);
        }
        const outstanding = invoicesBefore
            .filter(invoice => invoice.status !== 'CLOSED' && invoice.folioStatus === 'STAMPED' && Number.isFinite(invoice.due) && invoice.due > 0)
            .sort((a, b) => a.startDate.localeCompare(b.startDate));
        if (outstanding.length === 0) throw new Error(`No outstanding invoices found for account ${accountId}`);
        const oldestInvoice = outstanding[0];
        console.log('================================================');
        console.log('SELECTED OLDEST OUTSTANDING INVOICE');
        console.log(`Invoice ID: ${oldestInvoice.invoiceId}`);
        console.log(`Period: ${oldestInvoice.startDate} -> ${oldestInvoice.endDate}`);
        console.log(`Amount: ${oldestInvoice.due} CRC`);
        console.log('================================================');
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
                    invoiceId: oldestInvoice.invoiceId,
                    currency: 'CRC',
                    amount: oldestInvoice.due,
                }],
            },
        });
        const body = await response.json();
        console.log('Payment response:', body);
        expect(response.ok()).toBeTruthy();
        expect(body.status).toBe('SUCCESS');
        expect(body.statusCode).toBe('0');
        console.log(`PASS: Payment accepted for invoice ${oldestInvoice.invoiceId}`);
        let closedInvoice: InvoiceInfo | null = null;
        for (let attempt = 1; attempt <= 10; attempt++) {
            console.log(`Checking invoice ${oldestInvoice.invoiceId} status: ${attempt}/10`);
            await openBills();
            const invoicesAfter = await readInvoices();
            closedInvoice = invoicesAfter.find(invoice => invoice.invoiceId === oldestInvoice.invoiceId) ?? null;
            if (closedInvoice) {
                console.log(`Invoice Status: ${closedInvoice.status}`);
                console.log(`Outstanding Due: ${closedInvoice.due}`);
            }
            if (closedInvoice?.status === 'CLOSED' && closedInvoice.due === 0) break;
            if (attempt < 10) await page.waitForTimeout(5000);
        }
        expect(closedInvoice, `Invoice ${oldestInvoice.invoiceId} not found after payment`).not.toBeNull();
        expect(closedInvoice?.status, `Invoice ${oldestInvoice.invoiceId} did not reach CLOSED`).toBe('CLOSED');
        expect(closedInvoice?.due, `Invoice ${oldestInvoice.invoiceId} still has outstanding balance`).toBe(0);
        console.log('================================================');
        console.log('PASS: OLDEST INVOICE PAID AND CLOSED');
        console.log(`Account: ${accountId}`);
        console.log(`Invoice ID: ${oldestInvoice.invoiceId}`);
        console.log(`Period: ${oldestInvoice.startDate} -> ${oldestInvoice.endDate}`);
        console.log(`Amount Paid: ${oldestInvoice.due} CRC`);
        console.log('Final Invoice Status: CLOSED');
        console.log('Final Outstanding Due: 0');
        console.log('================================================');
        return {
            invoiceId: oldestInvoice.invoiceId,
            startDate: oldestInvoice.startDate,
            endDate: oldestInvoice.endDate,
            amount: oldestInvoice.due
        };
    };
    // ============================================================
    // INCOMPLETE ORDER
    // ============================================================
    const getIncompleteOrder = async (orderType: 'SUSPEND' | 'RESUME') => {
        await openServices();
        console.log(`Looking for incomplete ${orderType} order...`);
        await expect(page.getByRole('heading', { name: 'In-complete Orders' })).toBeVisible();
        for (let attempt = 1; attempt <= 10; attempt++) {
            const orderRow = page.getByRole('row').filter({ hasText: orderType }).filter({ hasText: 'ORD-' }).last();
            if (await orderRow.isVisible().catch(() => false)) {
                const rowText = await orderRow.innerText();
                const orderMatch = rowText.match(/ORD-[A-Za-z0-9-]+/);
                if (!orderMatch) throw new Error(`Could not find ${orderType} order ID: ${rowText}`);
                console.log(`PASS: ${orderType} order found: ${orderMatch[0]}`);
                return orderMatch[0];
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
        await queryDatabase(`UPDATE core_oms.order_prov_sequence_list SET status = 'COMPLETED' WHERE id = $1`, [orderId]);
        const remainingRows = await queryDatabase(`SELECT * FROM core_oms.order_prov_sequence_list WHERE id = $1 AND status <> 'COMPLETED'`, [orderId]);
        expect(remainingRows.length).toBe(0);
        console.log(`PASS: Provisioning completed for ${orderId}`);
    };
    const processOrder = async (orderType: 'SUSPEND' | 'RESUME') => {
        const orderId = await getIncompleteOrder(orderType);
        await completeOrderProvisioning(orderId, orderType);
        await page.waitForTimeout(3000);
        await expect(page.getByRole('button', { name: 'Submit order' })).toBeVisible();
        await page.getByRole('button', { name: 'Submit order' }).click();
        await verifyServiceStatus(orderType === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE');
        console.log(`PASS: ${orderType} order ${orderId} completed`);
        return orderId;
    };
    // ============================================================
    // MANUAL SUSPEND / RESUME
    // ============================================================
    const executeManualOrder = async (orderType: 'SUSPEND' | 'RESUME') => {
        await openServices();
        await page.getByRole('link', { name: orderType === 'SUSPEND' ? 'Suspend' : 'Resume', exact: true }).click();
        await page.getByRole('button', { name: 'Create', exact: true }).click();
        console.log(`PASS: Manual ${orderType} order created`);
        return await processOrder(orderType);
    };
    // ============================================================
    // MONTH 05 GRACE PERIOD - UI FROM TC10
    // ============================================================
    const applyGracePeriod = async (suspensionDate: string, gracePeriodDays: number) => {
        const action = await getCollectionInfo(suspensionDate);
        expect(action.action).toBe('INACTIVATE_SUBSCRIPTION');
        expect(action.nextActionDate).toBe(suspensionDate);

        const collectionUnitRow = page.locator('.col-md-12 > #scrollableDiv > .table > tbody > tr').filter({ hasText: suspensionDate }).first();
        await expect(collectionUnitRow).toBeVisible();

        const rowCheckbox = collectionUnitRow.locator('.custom-control');
        await expect(rowCheckbox).toBeVisible();
        await rowCheckbox.click();

        const statusSelect = page.locator('.form-group.select-group.col-md-4').filter({ hasText: 'Collection Unit Status' });
        await expect(statusSelect).toBeVisible();
        await statusSelect.click();

        const gracePeriodOption = page.locator('div[id^="react-select-"][id*="-option-"]').filter({ hasText: /^GRACE_PERIOD_REQUESTED$/ });
        await expect(gracePeriodOption).toBeVisible();
        await gracePeriodOption.click();

        await page.getByText('Grace Period', { exact: true }).click();
        const plusButton = page.locator('.plus-number');
        await expect(plusButton).toBeVisible();
        for (let i = 0; i < gracePeriodDays; i++) await plusButton.click();

        const commentBox = page.locator('textarea:visible').first();
        await expect(commentBox).toBeVisible();
        await commentBox.fill(`Grace period requested for ${gracePeriodDays} days from ${suspensionDate}`);
        await page.getByRole('button', { name: 'Apply' }).click();

        console.log(`PASS: ${gracePeriodDays}-day grace period requested for suspension date ${suspensionDate}`);
    };

    // ============================================================
    // LOGIN
    // ============================================================
    console.log('================================================');
    console.log(RUN_STEP === 0 ? 'TC08 MODE: FULL RUN' : `TC08 MODE: STEP ${RUN_STEP} ONLY`);
    console.log('================================================');
    await page.goto('https://core-ui.demo.embrix.org/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);
    console.log('PASS: Login successful');
    // ============================================================
    // STEP 1 - VERIFY TC07 SUSPENDED STATE
    // ============================================================
    if (shouldRun(1)) {
        await test.step('1 - Verify TC07 suspended state', async () => {
            await verifyServiceStatus('SUSPENDED');
        });
    }
    // ============================================================
    // STEP 2 - RUN FIRST BILLING CYCLE
    // ============================================================
    if (shouldRun(2)) {
        await test.step('2 - Run Month 03 billing', async () => {
            month03Bill = await runNextBillingCycle('MONTH 03');
        });
    }
    // ============================================================
    // STEP 3 - MONTH 03 COLLECTION THROUGH FIRST REMINDER
    // ============================================================
    if (shouldRun(3)) {
        await test.step('3 - Month 03 collection through first reminder', async () => {
            if (!month03Bill) {
                if (!BILLING_DATE) throw new Error('RUN_STEP=3 requires BILLING_DATE');
                month03Bill = await getStampedBillByPeriod(getPreviousMonthStart(BILLING_DATE), BILLING_DATE);
            }

            const suspension = await runCollection(month03Bill, 'MONTH 03');
            month03SuspensionDate = suspension.nextActionDate;

            console.log('================================================');
            console.log('PASS: MONTH 03 COLLECTION REMINDER COMPLETE');
            console.log(`Next suspension date: ${month03SuspensionDate}`);
            console.log('Month 03 suspension NOT executed yet.');
            console.log('================================================');
        });
    }

    // ============================================================
    // STEP 4 - PAY MONTH 02 AND PROCESS AUTOMATIC RESUME
    // ============================================================
    if (shouldRun(4)) {
        await test.step('4 - Pay Month 02 invoice and process automatic RESUME', async () => {
            if (!month03Bill) {
                if (!BILLING_DATE) throw new Error('RUN_STEP=4 requires BILLING_DATE');
                month03Bill = await getStampedBillByPeriod(getPreviousMonthStart(BILLING_DATE), BILLING_DATE);
            }

            await verifyServiceStatus('SUSPENDED');

            const expectedStart = getPreviousMonthStart(month03Bill.startDate);
            const expectedEnd = month03Bill.startDate;
            const payment = await payBill(expectedStart, expectedEnd);

            console.log('Waiting for automatic RESUME order...');
            await page.waitForTimeout(5000);
            const resumeOrderId = await processOrder('RESUME');

            console.log('================================================');
            console.log('PASS: MONTH 02 PAID AND SERVICE RECONNECTED');
            console.log(`Paid Invoice: ${payment.invoiceId}`);
            console.log(`Resume Order: ${resumeOrderId}`);
            console.log('Service Status: ACTIVE');
            console.log('Month 03 suspension is still scheduled.');
            console.log('================================================');
        });
    }

    // ============================================================
    // STEP 5 - RUN MONTH 03 SCHEDULED SUSPENSION
    // ============================================================
    if (shouldRun(5)) {
        await test.step('5 - Execute Month 03 scheduled suspension', async () => {
            if (!month03Bill) {
                if (!BILLING_DATE) throw new Error('RUN_STEP=5 requires BILLING_DATE');
                month03Bill = await getStampedBillByPeriod(getPreviousMonthStart(BILLING_DATE), BILLING_DATE);
            }

            if (!month03SuspensionDate) {
                const suspension = await getCollectionInfo(month03Bill.dueDate);
                expect(suspension.action).toBe('INACTIVATE_SUBSCRIPTION');
                month03SuspensionDate = suspension.nextActionDate;
            }

            await verifyServiceStatus('ACTIVE');
            console.log(`Executing Month 03 suspension job on ${month03SuspensionDate}`);
            await setCcpTime(month03SuspensionDate);
            await runExistingDailyJob(month03SuspensionDate);

            const suspendOrderId = await processOrder('SUSPEND');
            console.log('================================================');
            console.log('PASS: MONTH 03 SUSPENDED AFTER MONTH 02 RESUME');
            console.log(`Suspension Date: ${month03SuspensionDate}`);
            console.log(`Suspend Order: ${suspendOrderId}`);
            console.log('Service Status: SUSPENDED');
            console.log('================================================');
        });
    }

    // ============================================================
    // STEP 6 - MONTH 04 BILLING WHILE MONTH 03 IS SUSPENDED
    // ============================================================
    if (shouldRun(6)) {
        await test.step('6 - Run Month 04 billing while suspended', async () => {
            await verifyServiceStatus('SUSPENDED');
            month04Bill = await runNextBillingCycle('MONTH 04');

            console.log('================================================');
            console.log('PASS: MONTH 04 BILLING COMPLETE');
            console.log(`Bill Period: ${month04Bill.startDate} -> ${month04Bill.endDate}`);
            console.log(`Due Date: ${month04Bill.dueDate}`);
            console.log('================================================');
        });
    }

    // ============================================================
    // STEP 7 - PAY MONTH 03 AND PROCESS AUTOMATIC RESUME
    // ============================================================
    if (shouldRun(7)) {
        await test.step('7 - Pay Month 03 and process automatic RESUME', async () => {
            if (!month04Bill) {
                if (!BILLING_DATE) throw new Error('RUN_STEP=7 requires BILLING_DATE');
                month04Bill = await getStampedBillByPeriod(getPreviousMonthStart(BILLING_DATE), BILLING_DATE);
            }

            const expectedStart = getPreviousMonthStart(month04Bill.startDate);
            const expectedEnd = month04Bill.startDate;
            const payment = await payBill(expectedStart, expectedEnd);

            console.log('Waiting for automatic RESUME order...');
            await page.waitForTimeout(5000);
            const resumeOrderId = await processOrder('RESUME');

            console.log('================================================');
            console.log('PASS: MONTH 03 PAID AND SERVICE RECONNECTED');
            console.log(`Paid Invoice: ${payment.invoiceId}`);
            console.log(`Resume Order: ${resumeOrderId}`);
            console.log('Service Status: ACTIVE');
            console.log('================================================');
        });
    }

    // ============================================================
    // STEP 8 - MONTH 04 COLLECTION THROUGH FIRST REMINDER
    // ============================================================
    if (shouldRun(8)) {
        await test.step('8 - Run Month 04 collection through first reminder', async () => {
            if (!month04Bill) {
                if (!BILLING_DATE) throw new Error('RUN_STEP=8 requires BILLING_DATE');
                month04Bill = await getStampedBillByPeriod(getPreviousMonthStart(BILLING_DATE), BILLING_DATE);
            }

            await verifyServiceStatus('ACTIVE');
            await runCollection(month04Bill, 'MONTH 04');

            console.log('================================================');
            console.log('PASS: MONTH 04 COLLECTION THROUGH FIRST REMINDER');
            console.log(`Bill Period: ${month04Bill.startDate} -> ${month04Bill.endDate}`);
            console.log(`Collection Start: ${month04Bill.dueDate}`);
            console.log('================================================');
        });
    }

    // ============================================================
    // STEP 9 - MANUALLY SUSPEND ACTIVE SERVICE
    // ============================================================
    if (shouldRun(9)) {
        await test.step('9 - Manually suspend active service', async () => {
            await verifyServiceStatus('ACTIVE');
            const suspendOrderId = await executeManualOrder('SUSPEND');

            console.log('================================================');
            console.log('PASS: MANUAL SUSPENSION COMPLETE');
            console.log(`Suspend Order: ${suspendOrderId}`);
            console.log('Service Status: SUSPENDED');
            console.log('================================================');
        });
    }

    // ============================================================
    // STEP 10 - PAY MONTH 04 AND MANUALLY RESUME
    // ============================================================
    if (shouldRun(10)) {
        await test.step('10 - Pay Month 04 and manually resume', async () => {
            if (!month04Bill) {
                if (!BILLING_DATE) throw new Error('RUN_STEP=10 requires BILLING_DATE');
                month04Bill = await getStampedBillByPeriod(getPreviousMonthStart(BILLING_DATE), BILLING_DATE);
            }

            await verifyServiceStatus('SUSPENDED');
            const payment = await payBill(month04Bill.startDate, month04Bill.endDate);
            await verifyServiceStatus('SUSPENDED');
            const resumeOrderId = await executeManualOrder('RESUME');

            console.log('================================================');
            console.log('PASS: MONTH 04 PAYMENT AND MANUAL RECONNECTION');
            console.log(`Paid Invoice: ${payment.invoiceId}`);
            console.log(`Resume Order: ${resumeOrderId}`);
            console.log('Service Status: ACTIVE');
            console.log('================================================');
        });
    }

    // ============================================================
    // STEP 11 - MONTH 05 BILLING
    // ============================================================
    if (shouldRun(11)) {
        await test.step('11 - Run Month 05 billing', async () => {
            await verifyServiceStatus('ACTIVE');
            month05Bill = await runNextBillingCycle('MONTH 05');
            console.log(`PASS: Month 05 invoice ${month05Bill.startDate} -> ${month05Bill.endDate}, Due ${month05Bill.dueDate}`);
        });
    }

    // ============================================================
    // STEP 12 - MONTH 05 COLLECTION THROUGH FIRST REMINDER
    // ============================================================
    if (shouldRun(12)) {
        await test.step('12 - Month 05 collection through first reminder', async () => {
            if (!month05Bill) {
                if (!BILLING_DATE) throw new Error('RUN_STEP=12 requires BILLING_DATE');
                month05Bill = await getStampedBillByPeriod(getPreviousMonthStart(BILLING_DATE), BILLING_DATE);
            }

            const suspension = await runCollection(month05Bill, 'MONTH 05');
            month05OriginalSuspensionDate = suspension.nextActionDate;
            console.log(`PASS: Month 05 reminder complete; original suspension ${month05OriginalSuspensionDate}`);
        });
    }

    // ============================================================
    // STEP 13 - APPLY 5-DAY MONTH 05 GRACE PERIOD
    // ============================================================
    if (shouldRun(13)) {
        await test.step('13 - Request Month 05 five-day grace period', async () => {
            if (!month05OriginalSuspensionDate) {
                if (!BILLING_DATE) throw new Error('RUN_STEP=13 requires BILLING_DATE');
                month05Bill = await getStampedBillByPeriod(getPreviousMonthStart(BILLING_DATE), BILLING_DATE);
                const suspension = await getCollectionInfo(month05Bill.dueDate);
                expect(suspension.action).toBe('INACTIVATE_SUBSCRIPTION');
                month05OriginalSuspensionDate = suspension.nextActionDate;
            }

            await verifyServiceStatus('ACTIVE');
            await applyGracePeriod(month05OriginalSuspensionDate, 5);
            console.log(`PASS: Grace applied before original suspension on ${month05OriginalSuspensionDate}`);
        });
    }

    // ============================================================
    // STEP 14 - ORIGINAL SUSPENSION JOB MUST NOT SUSPEND
    // ============================================================
    if (shouldRun(14)) {
        await test.step('14 - Run original suspension job during grace period', async () => {
            if (!month05OriginalSuspensionDate) throw new Error('RUN_STEP=14 requires ORIGINAL_SUSPENSION_DATE when run alone');
            await verifyServiceStatus('ACTIVE');
            await setCcpTime(month05OriginalSuspensionDate);
            await runExistingDailyJob(month05OriginalSuspensionDate);
            await verifyServiceStatus('ACTIVE');
            console.log(`PASS: Service remained ACTIVE on original suspension date ${month05OriginalSuspensionDate}`);
        });
    }

    // ============================================================
    // STEP 15 - RESCHEDULED SUSPENSION AFTER GRACE
    // ============================================================
    if (shouldRun(15)) {
        await test.step('15 - Run rescheduled suspension job after grace period', async () => {
            if (!month05OriginalSuspensionDate) throw new Error('RUN_STEP=15 requires ORIGINAL_SUSPENSION_DATE when run alone');
            const updatedAction = await getCollectionInfo(month05OriginalSuspensionDate);
            expect(updatedAction.action).toBe('INACTIVATE_SUBSCRIPTION');
            if (updatedAction.nextActionDate <= month05OriginalSuspensionDate) {
                throw new Error(`Grace did not postpone suspension: original ${month05OriginalSuspensionDate}, current ${updatedAction.nextActionDate}`);
            }

            await verifyServiceStatus('ACTIVE');
            await setCcpTime(updatedAction.nextActionDate);
            await runExistingDailyJob(updatedAction.nextActionDate);
            const suspendOrderId = await processOrder('SUSPEND');

            console.log('================================================');
            console.log('PASS: MONTH 05 GRACE PERIOD AND SUSPENSION COMPLETE');
            console.log(`Original Suspension Date: ${month05OriginalSuspensionDate}`);
            console.log(`New Suspension Date: ${updatedAction.nextActionDate}`);
            console.log(`Suspend Order: ${suspendOrderId}`);
            console.log('Final Service Status: SUSPENDED');
            console.log('================================================');
        });
    }
});
