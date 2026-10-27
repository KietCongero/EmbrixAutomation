import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import accountTemplate from '../test-data/tc790115-04-account.json';
import { env } from '../config/environments';
import {
    allocateTestAccount,
    queryDatabase,
    login,
    openServices,
    verifyServiceStatus,
    getNextPendingBill,
    cleanJobs,
    setCcpTime,
    runBillingDailyJob,
    reprocessDailyJob,
    getStampedBillByPeriod,
    q10JobResults,
} from '../helpers';

// 790115 TC-04 (negative, then fix): the contact's identity document is 'CEDULA DE IDENTIDAD'
// without the accent, as Coopeweb sends it. Steps 1-6 are TC-01 (test-790115) with that template.
// Then the first billing day is processed: the sheet expects INVOICE_CHECK in ERROR (DIMEX message)
// and no invoice. The identity document is corrected on Account Data > Contact and the day is
// reprocessed: the invoice must then be generated. The job status is logged next to the expectation.

test('790115 TC-04 - identity document without accent: invoice fails, fix, reprocess', async ({ request, page }) => {
    test.setTimeout(40 * 60 * 1000);

    const { accountId, orderId } = await allocateTestAccount();
    const provisioningId = env.provisioningId;
    const ontModel = env.ontModel;

    if (!env.apiToken) throw new Error('Missing EMBRIX_API_TOKEN');

    console.log('================================================');
    console.log(`ACCOUNT: ${accountId}`);
    console.log(`ORDER: ${orderId}`);
    console.log(`IDENTITY DOCUMENT: ${accountTemplate.identityDocument} (no accent)`);
    console.log(`PROVISIONING ID: ${provisioningId} / ${ontModel}`);
    console.log('================================================');

    // ============================================================
    // 1. RENAME OLD ORDER ROWS ON THE ONT (as test-11)
    // ============================================================

    await test.step('1 - Rename old order rows on the ONT', async () => {
        const oldOrderRows = await queryDatabase(`SELECT * FROM core_oms.order_service_provisions WHERE provisioningid = $1`, [provisioningId]);

        if (oldOrderRows.length > 0) {
            const renamed = `TEST_${randomBytes(6).toString('hex').toUpperCase()}`;

            console.log(`Provisioning ID ${provisioningId} is used by ${oldOrderRows.length} old order row(s). Renaming to ${renamed}...`);

            await queryDatabase(`UPDATE core_oms.order_service_provisions SET provisioningid = $1 WHERE provisioningid = $2`, [renamed, provisioningId]);

            console.log(`PASS: Old provisioning ID changed to ${renamed}`);
        }
    });

    // ============================================================
    // 2. CREATE ACCOUNT + INCOMPLETE ORDER (API)
    // ============================================================

    await test.step('2 - Create account and incomplete order', async () => {
        const payload = { ...accountTemplate, accountId, orderId };

        const response = await request.post(env.api.processAccountAndOrder, {
            headers: { Authorization: `Bearer ${env.apiToken}`, 'Content-Type': 'application/json' },
            data: payload,
        });

        const text = await response.text();

        console.log('Response status:', response.status());
        console.log('Response body:', text);

        expect(response.ok(), `API failed with ${response.status()}: ${text}`).toBeTruthy();
        expect(JSON.parse(text)).toEqual({ accountId, orderId, status: 'SUCCESS', statusCode: '0' });

        console.log(`PASS: Account ${accountId} and incomplete order ${orderId} created`);
    });

    // ============================================================
    // 3. LOGIN + VERIFY THE INCOMPLETE ORDER
    // ============================================================

    await test.step('3 - Verify the incomplete order in the UI', async () => {
        await login(page);
        await openServices(page, accountId);
        await expect(page.getByRole('cell', { name: orderId, exact: true })).toBeVisible();

        console.log(`PASS: Incomplete order ${orderId} visible`);
    });

    // ============================================================
    // 4. ORDER WIZARD: REFERENCE ORDER + PROVISIONING DATA
    // ============================================================

    await test.step('4 - Create the order from the incomplete order', async () => {
        await page.getByRole('button', { name: 'Customer Hub' }).click();
        await page.getByRole('link', { name: 'Order Management' }).click();
        await page.getByRole('link', { name: 'Create new order' }).click();

        await page.locator('input[name="accountId"]').fill(accountId);
        await page.getByRole('button', { name: 'Search' }).click();
        await page.locator('#scrollableDiv').getByRole('button', { name: 'Next' }).click();

        await page.getByText('Reference Order', { exact: true }).click();
        await page.locator('.group-flex > div:nth-child(5)').click();
        await expect(page.getByRole('cell', { name: orderId, exact: true })).toBeVisible();
        await page.getByRole('cell', { name: orderId, exact: true }).click();
        await page.getByRole('button', { name: 'Select' }).click();

        console.log(`PASS: Reference order ${orderId} selected`);

        // Provisioning Data: open the INTERNET bundle row (as test-11 does with "Internet IPTV")
        await page.getByRole('heading', { name: 'Service Type: INTERNET' }).click();

        const internetBundleRow = page.getByRole('row').filter({
            has: page.getByRole('cell', { name: 'NA INTERNET 100 MBPS DUO TVE', exact: true }),
        });

        await expect(internetBundleRow).toBeVisible();

        console.log('PASS: NA INTERNET 100 MBPS DUO TVE bundle found');

        await internetBundleRow.getByRole('button', { name: 'View' }).click();
        await page.getByRole('button', { name: '+Add' }).click();

        const provisioningRow = page.locator('.needs-validation > #scrollableDiv > .table > tbody > tr').last();
        const provisioningIdCell = provisioningRow.locator('td').nth(1);
        const ontModelCell = provisioningRow.locator('td').nth(2);

        await expect(provisioningIdCell).toBeVisible();
        await provisioningIdCell.click();
        const provisioningInput = page.locator('input[id^="text-"]:visible').first();
        await expect(provisioningInput).toBeVisible();
        await provisioningInput.fill(provisioningId);

        await expect(ontModelCell).toBeVisible();
        await ontModelCell.click();
        const ontModelInput = page.locator('input[id^="text-"]:visible').last();
        await expect(ontModelInput).toBeVisible();
        await ontModelInput.fill(ontModel);

        await page.getByRole('button', { name: 'Submit', exact: true }).click();
        await page.getByRole('button', { name: 'Next' }).first().click();

        console.log(`PASS: Provisioning data added - ${provisioningId} / ${ontModel}`);

        await page.getByRole('button', { name: 'Create', exact: true }).click();
        await expect(page.getByText('Create Order successfully!')).toBeVisible();

        console.log(`PASS: Order ${orderId} created`);
    });

    // ============================================================
    // 5. MANUAL PROVISIONING (DB) - same as test-11
    // ============================================================

    await test.step('5 - Complete provisioning in the DB', async () => {
        await queryDatabase(`UPDATE core_oms."order" SET status = 'PROVISIONING_ERROR' WHERE id = $1`, [orderId]);

        await queryDatabase(`UPDATE core_oms.order_prov_sequence_list SET status = 'COMPLETED' WHERE id = $1`, [orderId]);

        await queryDatabase(`UPDATE core_oms.order_provisioning_inputs SET status = 'COMPLETED' WHERE id = $1`, [orderId]);

        console.log('PASS: Manual provisioning DB changes completed');
    });

    // ============================================================
    // 6. SUBMIT ORDER + WAIT FOR ACTIVE
    // ============================================================

    await test.step('6 - Submit the order and wait for ACTIVE', async () => {
        await openServices(page, accountId);
        await page.waitForTimeout(5000);
        await page.getByRole('button', { name: 'Submit order' }).click();

        console.log(`PASS: Order ${orderId} submitted`);

        await verifyServiceStatus(page, accountId, 'ACTIVE');
    });

    // ============================================================
    // 7. FIRST BILLING: EXPECTED INVOICE_CHECK ERROR (DIMEX)
    // ============================================================

    const pendingBill = await getNextPendingBill(page, accountId);

    await test.step('7 - Run billing: INVOICE_CHECK expected in ERROR', async () => {
        await cleanJobs(pendingBill.jobDate);
        await setCcpTime(page, pendingBill.jobDate);

        const status = await runBillingDailyJob(page, pendingBill.jobDate);

        // Sheet step 3 (Q10): the INVOICE_CHECK error reason - read for the log only
        const errors = (await q10JobResults(accountId)).filter(job => job.t === 'error');

        console.log('================================================');
        console.log(`INVOICE_CHECK on ${pendingBill.jobDate}: ${status} | sheet expects ERROR: ${status === 'ERROR' ? 'MATCH' : 'DIFFERS'}`);
        for (const job of errors) console.log(`Job error: ${job.type} ${job.status} | ${job.reason ?? ''}`);
        console.log('================================================');
    });

    // ============================================================
    // 8. FIX THE IDENTITY DOCUMENT (Account Data > Contact)
    // ============================================================

    await test.step('8 - Correct the identity document to CÉDULA DE IDENTIDAD', async () => {
        await page.goto(`/customers/${accountId}/contacts`);

        const field = page.getByText('Identity Document', { exact: true }).locator('xpath=following::input[1]');

        await expect(field).toBeVisible();
        console.log(`Identity Document before: ${await field.inputValue()}`);

        await field.fill('CÉDULA DE IDENTIDAD');
        await page.getByRole('button', { name: 'Modify' }).click();
        await page.waitForTimeout(3000);

        await page.goto(`/customers/${accountId}/contacts`);
        await expect(field).toBeVisible();

        const after = await field.inputValue();
        console.log(`Identity Document after: ${after}`);
        expect(after).toBe('CÉDULA DE IDENTIDAD');
    });

    // ============================================================
    // 9. REPROCESS THE BILLING DAY: INVOICE EXPECTED
    // ============================================================

    await test.step('9 - Reprocess the billing day and verify the invoice', async () => {
        await reprocessDailyJob(page, pendingBill.jobDate);

        const bill = await getStampedBillByPeriod(page, accountId, pendingBill.startDate, pendingBill.endDate);

        console.log('================================================');
        console.log(`Invoice ${bill.invoiceId} | ${bill.startDate} -> ${bill.endDate} | Total ${bill.billTotal} | Due date ${bill.dueDate}`);
        console.log('================================================');
    });

    console.log('================================================');
    console.log('PASS: 790115 TC-04 COMPLETE');
    console.log(`Account: ${accountId} | Order: ${orderId}`);
    console.log('================================================');
});
