import { test, expect } from '@playwright/test';
import { queryDatabase } from '../helpers/database';
import { runSpec, startSuite } from '../helpers/suite';
import { env } from '../config/environments';

test('TC09 - collections, payments, billing and plan change', async ({ page, request }) => {
    test.setTimeout(60 * 60 * 1000);

    const username = env.username;
    const password = env.password;
    const apiToken = env.apiToken;
    const accountId = await startSuite('TS02');

    const dailyJobUrl = '/jobs-management/job-schedule/CJ-12';
    const paymentUrl = env.api.applyPayment;
    const modifyUrl = env.api.processAccountAndOrder;

    const modifyOrderA = `MOD${accountId}A`;
    const modifyOrderB = `MOD${accountId}B`;

    if (!username || !password || !apiToken) throw new Error('Missing environment variables');

    type BillInfo = { startDate: string; endDate: string; jobDate: string };

    // ============================================================
    // COMMON
    // ============================================================

    const normalizeDate = (text: string) => {
        const match = text.match(/\d{4}-\d{2}-\d{2}/);
        if (!match) throw new Error(`Could not find date in: ${text}`);
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

    const openServices = async () => {
        await openAccount();
        await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
        await page.locator('a').filter({ hasText: 'Assets' }).click();
        await page.getByRole('link', { name: ' Services' }).click();

        console.log('PASS: Services opened');
    };

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
            const editor = document.querySelector('.CodeMirror');
            const codeMirror = (editor as any)?.CodeMirror;
            if (!codeMirror) throw new Error('CodeMirror editor not found');
            codeMirror.setValue(query);
            codeMirror.focus();
        }, mutation);

        await page.waitForTimeout(1000);
        await page.getByRole('button', { name: 'Execute Query (Ctrl-Enter)' }).click();
        await expect(page.locator('pre').filter({ hasText: `"ccpTime": "${targetDate}"` })).toBeVisible();

        console.log(`PASS: CCP time = ${targetDate}`);
    };

    const cleanJobs = async (targetDate: string) => {
        const jobs = await queryDatabase(`SELECT * FROM core_engine.job_schedule WHERE scheduledate = $1`, [targetDate]);

        for (const job of jobs) {
            await queryDatabase(`DELETE FROM core_engine.job_schedule_list WHERE id = $1`, [job.id]);
            await queryDatabase(`DELETE FROM core_engine.job_schedule WHERE id = $1`, [job.id]);
            console.log(`PASS: Deleted job ${job.id}`);
        }

        const remaining = await queryDatabase(`SELECT * FROM core_engine.job_schedule WHERE scheduledate = $1`, [targetDate]);

        expect(remaining.length, `Jobs still exist for ${targetDate}`).toBe(0);
    };

    // ============================================================
    // BILLING
    // ============================================================

    const getNextPendingBill = async (): Promise<BillInfo> => {
        await openAccount();

        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();

        console.log('Looking for next PENDING bill...');

        const pendingRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'PENDING', exact: true }) }).first();

        await expect(pendingRow).toBeVisible();

        const dates = pendingRow.getByRole('cell').filter({ hasText: /^\d{4}-\d{2}-\d{2}$/ });

        await expect(dates.nth(0)).toBeVisible();
        await expect(dates.nth(1)).toBeVisible();

        const startDate = (await dates.nth(0).innerText()).trim();
        const endDate = (await dates.nth(1).innerText()).trim();

        console.log(`PASS: PENDING bill ${startDate} -> ${endDate}`);

        return { startDate, endDate, jobDate: endDate };
    };

    const runBillingDailyJob = async (targetDate: string) => {
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

        await page.getByRole('button', { name: 'Create Job Schedule' }).click();
        await page.getByTitle('Refresh jobs').click();
        await page.waitForTimeout(2000);
        await page.getByRole('button', { name: 'Process' }).click();
        await page.getByRole('button', { name: 'Yes' }).click();

        console.log(`PASS: Billing started ${targetDate}`);

        await page.waitForTimeout(15000);

        for (let attempt = 1; attempt <= 20; attempt++) {
            console.log(`Checking INVOICE_CHECK ${attempt}/20`);

            await page.getByTitle('Refresh jobs').click();
            await page.waitForTimeout(15000);

            if (!(await page.getByRole('heading', { name: 'INVOICE_CHECK' }).isVisible().catch(() => false))) continue;

            if (await page.getByTitle('Status: COMPLETED').isVisible().catch(() => false)) {
                console.log(`PASS: INVOICE_CHECK completed ${targetDate}`);
                return;
            }

            if (await page.getByTitle('Status: ERROR').isVisible().catch(() => false)) {
                console.log(`WARNING: INVOICE_CHECK ERROR ${targetDate}`);
                return;
            }
        }

        console.log(`WARNING: INVOICE_CHECK completion not detected for ${targetDate}`);
    };

    const verifyStampedBill = async (bill: BillInfo) => {
        await openAccount();

        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();

        let row = page.getByRole('row').filter({ hasText: bill.startDate }).filter({ hasText: bill.endDate }).filter({ hasText: 'STAMPED' }).first();

        for (let attempt = 1; attempt <= 10; attempt++) {
            if (await row.isVisible().catch(() => false)) break;

            console.log(`Waiting for STAMPED bill ${attempt}/10`);
            await page.reload();
            await page.waitForTimeout(5000);

            row = page.getByRole('row').filter({ hasText: bill.startDate }).filter({ hasText: bill.endDate }).filter({ hasText: 'STAMPED' }).first();
        }

        await expect(row).toBeVisible();

        console.log(`PASS: STAMPED bill ${bill.startDate} -> ${bill.endDate}`);
    };

    const runBillingCycle = async (label: string) => {
        console.log('================================================');
        console.log(label);
        console.log('================================================');

        const bill = await getNextPendingBill();

        await cleanJobs(bill.jobDate);
        await setCcpTime(bill.jobDate);
        await runBillingDailyJob(bill.jobDate);
        await verifyStampedBill(bill);

        console.log(`PASS: ${label}`);

        return bill;
    };

    // ============================================================
    // BILL DETAILS + PAYMENT
    // ============================================================

    const getBillDetails = async (bill: BillInfo) => {
        await openAccount();

        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: /Bills/ }).click();

        const billRow = page.getByRole('row').filter({ hasText: bill.startDate }).filter({ hasText: bill.endDate }).filter({ hasText: 'STAMPED' }).first();

        await expect(billRow).toBeVisible();

        const view = billRow.getByRole('cell', { name: 'View', exact: true }).first();

        await expect(view).toBeVisible();
        await view.click();

        const table = page.getByRole('columnheader', { name: 'Invoice Id' }).locator('xpath=ancestor::table');
        const headers = table.locator('thead th');
        const row = table.locator('tbody tr').first();
        const headerTexts = await headers.allInnerTexts();

        const invoiceIndex = headerTexts.findIndex(x => x.trim() === 'Invoice Id');
        const totalIndex = headerTexts.findIndex(x => x.trim() === 'Bill Total');

        if (invoiceIndex === -1 || totalIndex === -1) throw new Error('Invoice Id or Bill Total column not found');

        const invoiceId = (await row.locator('td').nth(invoiceIndex).innerText()).trim();
        const totalText = (await row.locator('td').nth(totalIndex).innerText()).trim();
        const total = Number(totalText.replace(/,/g, '').replace(/[^\d.-]/g, ''));

        console.log(`Invoice: ${invoiceId}`);
        console.log(`Total: ${total}`);

        return { invoiceId, total };
    };

    const payBill = async (bill: BillInfo, label: string) => {
        console.log('================================================');
        console.log(`PAYMENT - ${label}`);
        console.log('================================================');

        const details = await getBillDetails(bill);

        const response = await request.post(paymentUrl, {
            headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
            data: {
                id: '',
                paymentSourceId: '',
                paymentDate: '',
                paymentSource: 'BCR',
                allocationData: [{ accountId, invoiceId: details.invoiceId, currency: 'CRC', amount: details.total }],
            },
        });

        const responseText = await response.text();

        console.log('Payment response:', responseText);

        expect(response.ok(), `Payment failed: ${response.status()} ${responseText}`).toBeTruthy();

        const body = JSON.parse(responseText);

        expect(body.status).toBe('SUCCESS');
        expect(body.statusCode).toBe('0');

        console.log(`PASS: ${label} PAID`);
    };

    // ============================================================
    // COLLECTION
    // ============================================================

    const getLatestStampedBill = async () => {
        await openAccount();

        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();

        await page.waitForTimeout(2000);
        await page.reload();
        await page.waitForTimeout(2000);

        const rows = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'STAMPED', exact: true }) });

        await expect(rows.first()).toBeVisible();

        const count = await rows.count();

        let latestDueDate = '';
        let latestStartDate = '';
        let latestEndDate = '';

        for (let r = 0; r < count; r++) {
            const row = rows.nth(r);
            const table = row.locator('xpath=ancestor::table[1]');
            const headers = table.getByRole('columnheader');
            const headerCount = await headers.count();

            let dueIndex = -1;

            for (let i = 0; i < headerCount; i++) {
                if ((await headers.nth(i).innerText()).trim() === 'Due Date') {
                    dueIndex = i;
                    break;
                }
            }

            if (dueIndex === -1) throw new Error('Due Date column not found');

            const dueDate = normalizeDate(await row.getByRole('cell').nth(dueIndex).innerText());
            const dates = row.getByRole('cell').filter({ hasText: /^\d{4}-\d{2}-\d{2}$/ });

            const startDate = await dates.nth(0).isVisible().catch(() => false) ? (await dates.nth(0).innerText()).trim() : '';
            const endDate = await dates.nth(1).isVisible().catch(() => false) ? (await dates.nth(1).innerText()).trim() : '';

            if (!latestDueDate || dueDate > latestDueDate) {
                latestDueDate = dueDate;
                latestStartDate = startDate;
                latestEndDate = endDate;
            }
        }

        if (!latestDueDate) throw new Error('Could not determine latest STAMPED bill');

        return { startDate: latestStartDate, endDate: latestEndDate, dueDate: latestDueDate };
    };

    const cleanCollectionJobs = async (referenceDate: string) => {
        const [year, month] = referenceDate.split('-').map(Number);
        const fromDate = `${year}-${String(month).padStart(2, '0')}-16`;
        // Every date from day 16 on, not just this month: on demo, jobs left by earlier runs past
        // month end hang Process / Create Job Schedule when a reminder or suspension lands there.
        const dates = await queryDatabase<{ date: string }>(
            `SELECT DISTINCT scheduledate::date::text AS date FROM core_engine.job_schedule WHERE scheduledate >= $1 ORDER BY 1`,
            [fromDate]
        );

        for (const { date } of dates) {
            await cleanJobs(date);
        }
    };

    const fillJobDate = async (targetDate: string) => {
        const input = page.getByRole('textbox').first();

        await input.click();
        await input.press('ControlOrMeta+a');
        await input.fill(targetDate);
        await input.press('Escape');
    };

    const waitAfterJobRun = async () => {
        for (let attempt = 1; attempt <= 6; attempt++) {
            console.log(`Checking job ${attempt}/6`);

            await page.waitForTimeout(5000);
            await page.getByTitle('Refresh jobs').click();

            if (await page.getByText('Completed', { exact: true }).first().isVisible().catch(() => false)) {
                console.log('PASS: Job COMPLETED');
                return;
            }
        }

        console.log('WARNING: Completed status not detected');
    };

    const createAndRunCollectionJob = async (targetDate: string) => {
        await page.goto(dailyJobUrl);
        await fillJobDate(targetDate);
        await page.getByRole('button', { name: 'Create Job Schedule' }).click();
        await page.getByTitle('Refresh jobs').click();
        await page.waitForTimeout(5000);
        await page.getByRole('button', { name: 'Process' }).click();
        await page.getByRole('button', { name: 'Yes' }).click();

        console.log(`PASS: Initial collection job started ${targetDate}`);

        await waitAfterJobRun();
    };

    const runExistingCollectionJob = async (targetDate: string) => {
        await page.goto(dailyJobUrl);
        await fillJobDate(targetDate);
        await page.getByTitle('Refresh jobs').click();
        await page.waitForTimeout(5000);

        await expect(page.getByRole('button', { name: 'Process' })).toBeVisible();
        await page.getByRole('button', { name: 'Process' }).click();
        await page.getByRole('button', { name: 'Yes' }).click();

        console.log(`PASS: Existing collection job started ${targetDate}`);

        await waitAfterJobRun();
    };

    const getCollectionInfo = async (expectedAction: string) => {
        for (let attempt = 1; attempt <= 10; attempt++) {
            console.log(`Collection search ${attempt}/10`);

            await page.goto('/dashboard/me');
            await page.getByRole('button', { name: 'AR Hub' }).click();
            await page.getByRole('link', { name: 'Collections' }).click();

            const search = page.locator('.form-group').first().getByRole('textbox');

            await search.fill(accountId);
            await page.getByRole('button', { name: 'Search' }).click();
            await page.waitForTimeout(10000);

            const view = page.getByRole('cell', { name: 'View' }).first();

            if (!(await view.isVisible().catch(() => false))) continue;

            await view.click();
            await page.waitForTimeout(2000);

            const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: expectedAction, exact: true }) }).last();

            if (!(await row.isVisible().catch(() => false))) continue;

            const table = row.locator('xpath=ancestor::table[1]');
            const headers = table.getByRole('columnheader');
            const count = await headers.count();

            let dateIndex = -1;

            for (let i = 0; i < count; i++) {
                if ((await headers.nth(i).innerText()).trim() === 'Next Action Date') {
                    dateIndex = i;
                    break;
                }
            }

            if (dateIndex === -1) throw new Error('Next Action Date column not found');

            const nextActionDate = normalizeDate(await row.getByRole('cell').nth(dateIndex).innerText());

            console.log(`PASS: ${expectedAction} = ${nextActionDate}`);

            return nextActionDate;
        }

        throw new Error(`${expectedAction} not found`);
    };

    const runCollection = async () => {
        const bill = await getLatestStampedBill();

        console.log('================================================');
        console.log('COLLECTION');
        console.log(`Bill: ${bill.startDate} -> ${bill.endDate}`);
        console.log(`Due: ${bill.dueDate}`);
        console.log('================================================');

        await cleanCollectionJobs(bill.dueDate);
        await setCcpTime(bill.dueDate);
        await createAndRunCollectionJob(bill.dueDate);

        const reminderDate = await getCollectionInfo('FIRST_REMINDER_EMAIL');

        await setCcpTime(reminderDate);
        await runExistingCollectionJob(reminderDate);

        console.log('PASS: COLLECTION THROUGH FIRST REMINDER');
    };

    // ============================================================
    // MODIFY API
    // ============================================================

    const runModifyPayload = async (payload: any, label: string) => {
        console.log('================================================');
        console.log(label);
        console.log(`ORDER: ${payload.orderId}`);
        console.log('================================================');

        const response = await request.post(modifyUrl, {
            headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
            data: payload,
        });

        const responseText = await response.text();

        console.log('Modify status:', response.status());
        console.log('Modify body:', responseText);

        expect(response.ok(), `${label} failed: ${response.status()} ${responseText}`).toBeTruthy();

        const body = JSON.parse(responseText);

        if (body.status === 'FAILED') throw new Error(`${label}: ${body.errorCode} - ${body.errorMsg}`);

        expect(body.status).toBe('SUCCESS');
        expect(body.statusCode).toBe('0');

        console.log(`PASS: ${label}`);
    };

    // ============================================================
    // PROCESS MODIFY ORDER
    // SAME MANUAL PROVISIONING PATTERN AS TEST 1
    // ============================================================

    const processModifyOrder = async (modifyOrderId: string) => {
        console.log('================================================');
        console.log(`PROCESS MODIFY ORDER ${modifyOrderId}`);
        console.log('================================================');

        // WAIT FOR MODIFY ORDER
        let orderFound = false;

        for (let attempt = 1; attempt <= 10; attempt++) {
            const orders = await queryDatabase(`SELECT * FROM core_oms."order" WHERE accountid = $1`, [accountId]);
            const order = orders.find((row: any) => String(row.id).toUpperCase() === modifyOrderId.toUpperCase());

            if (order) {
                orderFound = true;
                console.log(`PASS: Modify order found ${order.id} | status=${order.status}`);
                break;
            }

            console.log(`Waiting for ${modifyOrderId}: ${attempt}/10`);
            await page.waitForTimeout(3000);
        }

        if (!orderFound) throw new Error(`Modify order ${modifyOrderId} not found`);

        // WAIT FOR PROVISIONING ROWS TO STABILIZE
        let previousSequenceCount = -1;
        let previousInputCount = -1;
        let stableCount = 0;

        for (let attempt = 1; attempt <= 15; attempt++) {
            const sequenceRows = await queryDatabase(`SELECT * FROM core_oms.order_prov_sequence_list WHERE id = $1`, [modifyOrderId]);
            const inputRows = await queryDatabase(`SELECT * FROM core_oms.order_provisioning_inputs WHERE id = $1`, [modifyOrderId]);

            console.log(`Provisioning rows ${attempt}/15: sequence=${sequenceRows.length}, inputs=${inputRows.length}`);

            if (sequenceRows.length === previousSequenceCount && inputRows.length === previousInputCount && sequenceRows.length > 0) {
                stableCount++;
            } else {
                stableCount = 0;
            }

            previousSequenceCount = sequenceRows.length;
            previousInputCount = inputRows.length;

            if (stableCount >= 2) {
                console.log('PASS: Provisioning rows stabilized');
                break;
            }

            await page.waitForTimeout(3000);
        }

        // FORCE ORDER INTO MANUAL PROVISIONING STATE
        await queryDatabase(`UPDATE core_oms."order" SET status = 'PROVISIONING_ERROR' WHERE id = $1`, [modifyOrderId]);

        // COMPLETE EVERYTHING CURRENTLY CREATED
        await queryDatabase(`UPDATE core_oms.order_prov_sequence_list SET status = 'COMPLETED' WHERE id = $1`, [modifyOrderId]);
        await queryDatabase(`UPDATE core_oms.order_provisioning_inputs SET status = 'COMPLETED' WHERE id = $1`, [modifyOrderId]);

        let remainingSequence = await queryDatabase(`SELECT * FROM core_oms.order_prov_sequence_list WHERE id = $1 AND status <> 'COMPLETED'`, [modifyOrderId]);
        let remainingInputs = await queryDatabase(`SELECT * FROM core_oms.order_provisioning_inputs WHERE id = $1 AND status <> 'COMPLETED'`, [modifyOrderId]);

        expect(remainingSequence.length, `Sequence rows still not completed before submit`).toBe(0);
        expect(remainingInputs.length, `Input rows still not completed before submit`).toBe(0);

        console.log(`PASS: All rows COMPLETED before submit for ${modifyOrderId}`);

        // OPEN MODIFY ORDER
        await openServices();
        await page.waitForTimeout(3000);

        const modifyRow = page.getByRole('row').filter({ hasText: modifyOrderId }).first();

        if (await modifyRow.isVisible().catch(() => false)) {
            console.log(`PASS: ${modifyOrderId} visible in Services`);
        }

        // SUBMIT MODIFY ORDER
        const submitButton = page.getByRole('button', { name: 'Submit order', exact: true });

        await expect(submitButton).toBeVisible();
        await submitButton.click();

        console.log(`PASS: ${modifyOrderId} submitted`);

        // EMBRIX MAY CREATE OR CHANGE PROVISIONING ROWS AFTER SUBMIT.
        // KEEP COMPLETING EVERYTHING UNTIL THEY STAY COMPLETED.
        for (let attempt = 1; attempt <= 10; attempt++) {
            await page.waitForTimeout(3000);

            const badSequence = await queryDatabase(`SELECT * FROM core_oms.order_prov_sequence_list WHERE id = $1 AND status <> 'COMPLETED'`, [modifyOrderId]);
            const badInputs = await queryDatabase(`SELECT * FROM core_oms.order_provisioning_inputs WHERE id = $1 AND status <> 'COMPLETED'`, [modifyOrderId]);

            console.log(`Post-submit check ${attempt}/10: sequence not completed=${badSequence.length}, inputs not completed=${badInputs.length}`);

            if (badSequence.length === 0 && badInputs.length === 0) {
                console.log(`PASS: All provisioning rows remain COMPLETED for ${modifyOrderId}`);
                break;
            }

            if (badSequence.length > 0) {
                console.log('Fixing sequence rows:');
                for (const row of badSequence) console.log(`  ${row.apiname} = ${row.status}`);

                await queryDatabase(`UPDATE core_oms.order_prov_sequence_list SET status = 'COMPLETED' WHERE id = $1`, [modifyOrderId]);
            }

            if (badInputs.length > 0) {
                console.log('Fixing provisioning inputs:');
                for (const row of badInputs) console.log(`  ${row.apiname || row.type || 'INPUT'} = ${row.status}`);

                await queryDatabase(`UPDATE core_oms.order_provisioning_inputs SET status = 'COMPLETED' WHERE id = $1`, [modifyOrderId]);
            }
        }

        // FINAL HARD CHECK
        remainingSequence = await queryDatabase(`SELECT * FROM core_oms.order_prov_sequence_list WHERE id = $1 AND status <> 'COMPLETED'`, [modifyOrderId]);
        remainingInputs = await queryDatabase(`SELECT * FROM core_oms.order_provisioning_inputs WHERE id = $1 AND status <> 'COMPLETED'`, [modifyOrderId]);

        expect(remainingSequence.length, `Sequence rows still not COMPLETED after submit for ${modifyOrderId}`).toBe(0);
        expect(remainingInputs.length, `Input rows still not COMPLETED after submit for ${modifyOrderId}`).toBe(0);

        console.log(`PASS: ALL sequence + input rows COMPLETED for ${modifyOrderId}`);

        // CHECK ORDER STATUS
        const orders = await queryDatabase(`SELECT * FROM core_oms."order" WHERE accountid = $1`, [accountId]);
        const finalOrder = orders.find((row: any) => String(row.id).toUpperCase() === modifyOrderId.toUpperCase());

        if (finalOrder) console.log(`FINAL ${modifyOrderId} status = ${finalOrder.status}`);

        console.log('================================================');
        console.log(`PASS: MODIFY PROCESSING FINISHED ${modifyOrderId}`);
        console.log('================================================');
    };

    // ============================================================
    // MODIFY A
    // ============================================================

    const modifyAddTv = async () => {
        const payload = {
            userId: 'KCONG',
            accountId,
            orderType: 'MODIFY',
            billOrderCharges: 'false',
            staticIpRented: 'false',
            orderId: modifyOrderA,
            services: [
                { bundleId: 'BDL_TV_ADIC', packageId: '', serviceType: 'IPTV', action: 'ADD', quantity: '2' },
                { bundleId: 'BDL_IPTV', packageId: 'PKG_IPTV_STANDARD', serviceType: 'INTERNET', action: 'ADD', quantity: '1' },
                { bundleId: 'BDL_TV_IND', packageId: 'PKG_IPTV_STANDARD', serviceType: 'IPTV', action: 'ADD', quantity: '1' },
            ],
        };

        await runModifyPayload(payload, 'MODIFY A - ADD IPTV STANDARD + TV ADIC x2');
        await processModifyOrder(modifyOrderA);
    };

    // ============================================================
    // MODIFY B
    // CANCEL ONE TV ADIC
    // ============================================================

    const modifyCancelOneTv = async () => {
        const payload = {
            userId: 'KCONG',
            accountId,
            orderType: 'MODIFY',
            billOrderCharges: 'false',
            staticIpRented: 'false',
            orderId: modifyOrderB,
            services: [
                { bundleId: 'BDL_TV_ADIC', packageId: '', serviceType: 'IPTV', action: 'CANCEL', quantity: '1' },
            ],
        };

        await runModifyPayload(payload, 'MODIFY B - CANCEL 1 TV ADIC');
        await processModifyOrder(modifyOrderB);
    };

    // ============================================================
    // TC09
    // ============================================================

    console.log('================================================');
    console.log('START TC09');
    console.log(`ACCOUNT: ${accountId}`);
    console.log(`MODIFY A: ${modifyOrderA}`);
    console.log(`MODIFY B: ${modifyOrderB}`);
    console.log('================================================');

    // ============================================================
    // CREATE ACCOUNT USING EXISTING TEST 1
    // ============================================================

    await test.step('Create account and provision', async () => {
        runSpec('tests/test-1.spec.ts', { headed: true });
        console.log('PASS: TEST 1 COMPLETED');
    });

    /*
     * IMPORTANT:
     * test-1.spec.ts above runs in a separate Playwright process.
     * Its logged-in browser session cannot be reused by this test.
     * This is the only login TC09 needs.
     */

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('PASS: TC09 session logged in');

    let bill1!: BillInfo;
    let bill2!: BillInfo;
    let bill3!: BillInfo;
    let bill4!: BillInfo;
    let bill5!: BillInfo;

    // ============================================================
    // BILL -> COLLECTION -> PAYMENT
    // ============================================================

    await test.step('Billing Run 1', async () => {
        bill1 = await runBillingCycle('BILLING RUN 1');
    });

    await test.step('Collection', async () => {
        await runCollection();
    });

    await test.step('Pay Billing Run 1', async () => {
        await payBill(bill1, 'BILLING RUN 1');
    });

    // ============================================================
    // MODIFY A
    // ============================================================

    await test.step('Modify A - Add IPTV + TV ADIC x2', async () => {
        await modifyAddTv();
    });

    // ============================================================
    // BILL -> PAY
    // ============================================================

    await test.step('Billing Run 2', async () => {
        bill2 = await runBillingCycle('BILLING RUN 2');
    });

    await test.step('Pay Billing Run 2', async () => {
        await payBill(bill2, 'BILLING RUN 2');
    });

    // ============================================================
    // BILL -> PAY
    // ============================================================

    await test.step('Billing Run 3', async () => {
        bill3 = await runBillingCycle('BILLING RUN 3');
    });

    await test.step('Pay Billing Run 3', async () => {
        await payBill(bill3, 'BILLING RUN 3');
    });

    // ============================================================
    // BILL
    // ============================================================

    await test.step('Billing Run 4', async () => {
        bill4 = await runBillingCycle('BILLING RUN 4');
    });

    // ============================================================
    // MODIFY B - CANCEL ONE
    // ============================================================

    await test.step('Modify B - Cancel 1 TV ADIC', async () => {
        await modifyCancelOneTv();
    });

    // ============================================================
    // PAY BILL CREATED BEFORE MODIFY B
    // ============================================================

    await test.step('Pay Billing Run 4', async () => {
        await payBill(bill4, 'BILLING RUN 4');
    });

    // ============================================================
    // FINAL BILL
    // ============================================================

    await test.step('Billing Run 5', async () => {
        bill5 = await runBillingCycle('BILLING RUN 5');

        const details = await getBillDetails(bill5);

        console.log('================================================');
        console.log('FINAL BILL');
        console.log(`Invoice: ${details.invoiceId}`);
        console.log(`Total: ${details.total}`);
        console.log('Expected: IPTV Standard + TV ADIC x1');
        console.log('================================================');
    });

    console.log('================================================');
    console.log('PASS: TC09 COMPLETE');
    console.log(`Account: ${accountId}`);
    console.log(`Modify A: ${modifyOrderA}`);
    console.log(`Modify B: ${modifyOrderB}`);
    console.log(`Bill 1: ${bill1.startDate} -> ${bill1.endDate} PAID AFTER COLLECTION`);
    console.log(`Bill 2: ${bill2.startDate} -> ${bill2.endDate} PAID`);
    console.log(`Bill 3: ${bill3.startDate} -> ${bill3.endDate} PAID`);
    console.log(`Bill 4: ${bill4.startDate} -> ${bill4.endDate} PAID AFTER MODIFY B`);
    console.log(`Bill 5: ${bill5.startDate} -> ${bill5.endDate} FINAL`);
    console.log('================================================');
});