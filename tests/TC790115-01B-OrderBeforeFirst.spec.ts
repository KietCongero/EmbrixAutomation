import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import accountTemplate from '../test-data/tc790115-account.json';
import { env } from '../config/environments';
import { allocateTestAccount, queryDatabase, login, openServices, verifyServiceStatus, getCcpTime, setCcpTime, addDays, dayOfMonth, nextMonthFirst } from '../helpers';

// 790115 TC-01-B: TC-01 (test-790115.spec.ts) step for step, for the TC-03 scenario (EFT-99):
// the order is dated before a 1st and the services are activated after that 1st. Only the
// dates differ from TC-01: the account is created at the current CCP time (moved to the 2nd
// when it sits on a 1st), and the CCP time is moved to the day after the next 1st before
// provisioning. The ONT must already be free - checking that is a manual step (see README).

test('790115 TC-01-B - create account before a 1st, provision Internet + IPTV + VOIP after it', async ({ request, page }) => {
    test.setTimeout(20 * 60 * 1000);

    const { accountId, orderId } = await allocateTestAccount();
    const provisioningId = env.provisioningId;
    const ontModel = env.ontModel;

    if (!env.apiToken) throw new Error('Missing EMBRIX_API_TOKEN');

    console.log('================================================');
    console.log(`ACCOUNT: ${accountId}`);
    console.log(`ORDER: ${orderId}`);
    console.log(`PACKAGE: ${accountTemplate.services[0].packageId}`);
    console.log(`PROVISIONING ID: ${provisioningId} / ${ontModel}`);
    console.log('================================================');

    let orderDate = '';
    let activationDate = '';

    // ============================================================
    // 0. ORDER DATE BEFORE A 1ST (CCP time only moves forward)
    // ============================================================

    await test.step('0 - Make sure the order is dated before a 1st', async () => {
        await login(page);

        orderDate = await getCcpTime(page);

        if (dayOfMonth(orderDate) === 1) {
            orderDate = addDays(orderDate, 1);
            await setCcpTime(page, orderDate);
        }

        activationDate = addDays(nextMonthFirst(orderDate), 1);

        console.log(`ORDER DATE: ${orderDate} | ACTIVATION DATE: ${activationDate}`);
    });

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
    // 3. VERIFY THE INCOMPLETE ORDER (already logged in from step 0)
    // ============================================================

    await test.step('3 - Verify the incomplete order in the UI', async () => {
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
    // 4B. MOVE THE CCP TIME PAST THE NEXT 1ST (activation after the 1st)
    // ============================================================

    await test.step('4B - Move the CCP time to the day after the next 1st', async () => {
        await setCcpTime(page, activationDate);
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

    console.log('================================================');
    console.log('PASS: 790115 TC-01-B COMPLETE');
    console.log(`Account: ${accountId} | Order: ${orderId} | ONT: ${provisioningId}`);
    console.log(`Order date: ${orderDate} | Activation date: ${activationDate}`);
    console.log('================================================');
});
