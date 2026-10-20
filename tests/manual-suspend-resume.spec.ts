
import { test, expect } from '@playwright/test';
import { queryDatabase } from '../helpers/database';
import { ACCOUNT_ID } from '../test-data/testIds';

test('Manual Suspension and Manual Resume', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;
    const accountId = ACCOUNT_ID;

    if (!username || !password) throw new Error('Missing username or password');

    // ============================================================
    // OPEN SERVICES
    // ============================================================

    const openServices = async () => {
        await page.goto('https://core-ui.demo.embrix.org/dashboard/me');
        await page.getByRole('button', { name: 'Customer Hub' }).click();
        await page.getByRole('link', { name: 'Customer Management' }).first().click();

        const accountSearch = page.locator('.form-group').first().getByRole('textbox');

        await accountSearch.fill(accountId);
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.getByRole('link', { name: accountId, exact: true }).click();

        await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
        await page.locator('a').filter({ hasText: 'Assets' }).click();
        await page.getByRole('link', { name: ' Services' }).click();

        console.log(`PASS: Account ${accountId} services opened`);
    };

    // ============================================================
    // VERIFY SERVICE STATUS
    // ============================================================

    const verifyServiceStatus = async (expectedStatus: 'ACTIVE' | 'SUSPENDED') => {
        await openServices();

        console.log(`Waiting for service status ${expectedStatus}...`);

        for (let attempt = 1; attempt <= 10; attempt++) {
            const status = page.getByRole('cell', { name: expectedStatus, exact: true }).first();

            if (await status.isVisible().catch(() => false)) {
                console.log(`PASS: Service status is ${expectedStatus}`);
                return;
            }

            await page.waitForTimeout(5000);
            await page.getByRole('button', { name: 'Refresh' }).click();
        }

        throw new Error(`Service ${accountId} did not reach ${expectedStatus}`);
    };

    // ============================================================
    // FIND INCOMPLETE ORDER
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

    // ============================================================
    // COMPLETE MANUAL PROVISIONING
    // ============================================================

    const completeOrderProvisioning = async (orderId: string) => {
        console.log(`Updating provisioning for ${orderId}...`);

        const sequenceRows = await queryDatabase(
            `SELECT * FROM core_oms.order_prov_sequence_list WHERE id = $1`,
            [orderId]
        );

        if (sequenceRows.length === 0) throw new Error(`No provisioning sequence found for ${orderId}`);

        await queryDatabase(
            `UPDATE core_oms.order_prov_sequence_list SET status = 'COMPLETED' WHERE id = $1`,
            [orderId]
        );

        const remainingRows = await queryDatabase(
            `SELECT * FROM core_oms.order_prov_sequence_list WHERE id = $1 AND status <> 'COMPLETED'`,
            [orderId]
        );

        expect(remainingRows.length, `Provisioning incomplete for ${orderId}`).toBe(0);

        console.log(`PASS: Provisioning completed for ${orderId}`);
    };

    // ============================================================
    // MANUAL ORDER FLOW
    // ============================================================

    const executeManualOrder = async (orderType: 'SUSPEND' | 'RESUME') => {
        console.log('================================================');
        console.log(`STARTING MANUAL ${orderType}`);
        console.log('================================================');

        await openServices();

        await page.getByRole('link', { name: orderType === 'SUSPEND' ? 'Suspend' : 'Resume', exact: true }).click();
        await page.getByRole('button', { name: 'Create', exact: true }).click();

        console.log(`PASS: Manual ${orderType} order created`);

        const orderId = await getIncompleteOrder(orderType);

        await completeOrderProvisioning(orderId);

        await expect(page.getByRole('button', { name: 'Submit order' })).toBeVisible();
        await page.getByRole('button', { name: 'Submit order' }).click();

        console.log(`PASS: ${orderType} order ${orderId} submitted`);

        return orderId;
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
    // STEP 1 - VERIFY ACTIVE
    // ============================================================

    await verifyServiceStatus('ACTIVE');

    // ============================================================
    // STEP 2 - MANUAL SUSPENSION
    // ============================================================

    const suspendOrderId = await executeManualOrder('SUSPEND');
    await verifyServiceStatus('SUSPENDED');

    // ============================================================
    // STEP 3 - MANUAL RESUME
    // ============================================================

    const resumeOrderId = await executeManualOrder('RESUME');
    await verifyServiceStatus('ACTIVE');

    // ============================================================
    // SUMMARY
    // ============================================================

    console.log('================================================');
    console.log('MANUAL SUSPENSION AND RESUME PASSED');
    console.log(`Account: ${accountId}`);
    console.log(`Suspend Order: ${suspendOrderId}`);
    console.log(`Resume Order: ${resumeOrderId}`);
    console.log('Final Service Status: ACTIVE');
    console.log('================================================');
});
