import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { queryDatabase } from '../helpers/database';

test('create order, manually provision, and submit order', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;

    const accountId = '9000040';
    const orderId = `ORD${accountId}`;
    const provisioningId = 'ALCLB3A97FBA';
    const ontModel = 'G-240W-G';

    if (!username || !password) {
        throw new Error('Missing username or password');
    }

    // Check provisioning ID before starting automation
    console.log(`Checking provisioning ID ${provisioningId}...`);

    const oldOrderRows = await queryDatabase(
        `
        SELECT *
        FROM core_oms.order_service_provisions
        WHERE provisioningid = $1
        `,
        [provisioningId]
    );

    if (oldOrderRows.length > 0) {
        const randomProvisioningId = `TEST_${randomBytes(6).toString('hex').toUpperCase()}`;

        console.log(
            `Provisioning ID ${provisioningId} is already being used by ${oldOrderRows.length} order row(s). Changing it to ${randomProvisioningId}...`
        );

        await queryDatabase(
            `
            UPDATE core_oms.order_service_provisions
            SET provisioningid = $1
            WHERE provisioningid = $2
            `,
            [randomProvisioningId, provisioningId]
        );

        console.log(
            `PASS: Existing order provisioning ID changed from ${provisioningId} to ${randomProvisioningId}`
        );
    } else {
        console.log(`No order rows are using provisioning ID ${provisioningId}`);
    }

    const activeRows = await queryDatabase(
        `
        SELECT provisioningid, ratingprovisioningid, enddate
        FROM core_engine.service_provision
        WHERE provisioningid = $1
          AND enddate IS NULL
        `,
        [provisioningId]
    );

    if (activeRows.length > 0) {
        const ratingIds = activeRows.map(row => row.ratingprovisioningid).join(', ');

        console.log(`Provisioning ID ${provisioningId} is still being used by an active subscription`);
        console.log(`Cancel the active subscription for ratingProvisioningId: ${ratingIds}`);

        return;
    }

    console.log(`PASS: Provisioning ID ${provisioningId} is free`);
    console.log('Starting Embrix automation...');

    // Login
    await page.goto('https://core-ui.demo.embrix.org/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('Login successful');

    // Create order
    await page.getByRole('button', { name: 'Customer Hub' }).click();
    await page.getByRole('link', { name: 'Order Management' }).click();
    await page.getByRole('link', { name: 'Create new order' }).click();

    await page.locator('input[name="accountId"]').fill(accountId);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.locator('#scrollableDiv').getByRole('button', { name: 'Next' }).click();

    await page.getByText('Reference Order', { exact: true }).click();
    await page.locator('.group-flex > div:nth-child(5)').click();
    await page.getByRole('cell', { name: orderId, exact: true }).click();
    await page.getByRole('button', { name: 'Select' }).click();

    // Provisioning data
    await page.getByRole('button', { name: 'View' }).click();
    await page.getByRole('button', { name: '+Add' }).click();

    const emptyCells = page.getByRole('cell').filter({ hasText: /^$/ });
    const provisioningIdCell = emptyCells.nth(4);
    const ontModelCell = emptyCells.nth(5);

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

    console.log(`Creating order ${orderId}...`);

    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText('Create Order successfully!')).toBeVisible();

    console.log('PASS: Order created successfully');

    // Manual provisioning - database
    console.log('Starting manual provisioning database changes...');

    await queryDatabase(
        `
        UPDATE core_oms."order"
        SET status = 'PROVISIONING_ERROR'
        WHERE id = $1
        `,
        [orderId]
    );

    await queryDatabase(
        `
        UPDATE core_oms.order_prov_sequence_list
        SET status = CASE
            WHEN apiname IN (
                'GET_LOCATION_DATA',
                'GET_SPACE_DATA',
                'CREATE_PROVISIONING_ORDER',
                'UPDATE_OPERATIVE_STATUS',
                'UPDATE_OPTICAL_DATA',
                'UPDATE_WORK_ORDER'
            ) THEN 'COMPLETED'
            WHEN apiname IN (
                'CREATE_PROVISION_IPTV_ORDER',
                'GET_ACCOUNT_PROVISIONING_DATA',
                'UPDATE_PROVISIONING_TEMPLATE_DETAILS'
            ) THEN 'SKIPPED'
            ELSE status
        END
        WHERE id = $1
        `,
        [orderId]
    );

    await queryDatabase(
        `
        UPDATE core_oms.order_provisioning_inputs
        SET status = 'COMPLETED'
        WHERE id = $1
        `,
        [orderId]
    );

    console.log('PASS: Manual provisioning database changes completed');

    // Go to customer
    await page.getByRole('button', { name: 'Customer Hub' }).click();
    await page.getByRole('link', { name: 'Customer Management' }).first().click();

    const accountSearch = page.locator('.form-group').first().getByRole('textbox');
    await accountSearch.fill(accountId);

    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('link', { name: accountId, exact: true }).click();

    // Subscription Data -> Assets -> Services
    await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
    await page.locator('a').filter({ hasText: 'Assets' }).click();
    await page.getByRole('link', { name: ' Services' }).click();

    console.log('Waiting 5 seconds before submitting order...');
    await page.waitForTimeout(5000);

    await page.getByRole('button', { name: 'Submit order' }).click();

    console.log('Order submitted');

    let activeFound = false;

    for (let attempt = 1; attempt <= 10; attempt++) {
        console.log(`Checking for ACTIVE status: ${attempt}/10`);

        await page.waitForTimeout(5000);
        await page.getByRole('button', { name: 'Refresh' }).click();

        const activeStatus = page.getByRole('cell', { name: 'ACTIVE', exact: true }).first();

        if (await activeStatus.isVisible().catch(() => false)) {
            console.log('PASS: Service status is ACTIVE');
            activeFound = true;
            break;
        }

        console.log('ACTIVE not found. Refreshing again in 5 seconds...');
    }

    expect(activeFound).toBe(true);
});