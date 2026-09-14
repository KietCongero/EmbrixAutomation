import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import accountTemplate from '../test-data/tc01-account.json';
import { queryDatabase } from '../helpers/database';

test('environment check', async ({ request, page }) => {
    test.setTimeout(20 * 60 * 1000);

    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;
    const apiUrl = process.env.EMBRIX_API_URL;
    const apiToken = process.env.EMBRIX_API_TOKEN;

    //Change this to run the cancelation and create new account of "RUN_NUMER+1"
    const RUN_NUMBER = 116;

    if (!RUN_NUMBER) throw new Error('Missing RUN_NUMBER');

    const previousAccountId = String(9000000 + RUN_NUMBER);
    const accountId = String(9000000 + RUN_NUMBER + 1);
    const orderId = `ORD${accountId}`;

    const provisioningId = 'ALCLB3A97FBA';
    const ontModel = 'G-240W-G';
    const uiUrl = 'https://core-ui.demo.embrix.org';

    if (!username || !password || !apiUrl || !apiToken) throw new Error('Missing environment variables');

    console.log(`Cleanup: ${previousAccountId} | Create: ${accountId}`);

    // LOGIN
    await page.goto(`${uiUrl}/login`);
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    // TRY CANCEL PREVIOUS ACCOUNT
    await page.getByRole('button', { name: 'Customer Hub' }).click();
    await page.getByRole('link', { name: 'Customer Management' }).first().click();

    const search = page.locator('.form-group').first().getByRole('textbox');
    await search.fill(previousAccountId);
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    const previousAccount = page.getByRole('link', {
        name: previousAccountId,
        exact: true,
    });

    const previousAccountExists = await previousAccount
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);

    if (previousAccountExists) {
        console.log(`PASS: ${previousAccountId} found`);

        await previousAccount.click();

        await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
        await page.locator('a').filter({ hasText: 'Assets' }).click();
        await page.getByRole('link', { name: ' Services' }).click();

        const cancel = page.getByRole('link', { name: 'Cancel', exact: true });

        if (await cancel.isVisible().catch(() => false)) {
            await cancel.click();
            await page.getByRole('button', { name: 'Create', exact: true }).click();
            await page.getByRole('button', { name: 'Submit order' }).click();

            await page.goto(`${uiUrl}/customers/${previousAccountId}/services`);

            for (let i = 1; i <= 10; i++) {
                await page.waitForTimeout(5000);
                await page.getByRole('button', { name: 'Refresh' }).click();

                if (
                    await page
                        .getByRole('cell', { name: 'CLOSED', exact: true })
                        .first()
                        .isVisible()
                        .catch(() => false)
                ) {
                    console.log(`PASS: ${previousAccountId} cancelled`);
                    break;
                }
            }
        } else {
            console.log(`SKIP: ${previousAccountId} has nothing to cancel`);
        }
    } else {
        console.log(`SKIP: ${previousAccountId} does not exist`);
    }

    // FREE PROVISIONING ID
    const oldRows = await queryDatabase(`
    SELECT * FROM core_oms.order_service_provisions WHERE provisioningid = $1
  `, [provisioningId]);

    if (oldRows.length) {
        const replacement = `TEST_${randomBytes(6).toString('hex').toUpperCase()}`;

        await queryDatabase(`
      UPDATE core_oms.order_service_provisions
      SET provisioningid = $1
      WHERE provisioningid = $2
    `, [replacement, provisioningId]);
    }

    const activeRows = await queryDatabase(`
    SELECT ratingprovisioningid
    FROM core_engine.service_provision
    WHERE provisioningid = $1 AND enddate IS NULL
  `, [provisioningId]);

    if (activeRows.length) throw new Error(`Provisioning ID ${provisioningId} is still active`);

    // CREATE ACCOUNT
    const response = await request.post(apiUrl, {
        headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
        },
        data: { ...accountTemplate, accountId, orderId },
    });

    const responseText = await response.text();

    expect(response.ok(), `API failed: ${responseText}`).toBeTruthy();

    const body = JSON.parse(responseText);

    expect(body).toEqual({
        accountId,
        orderId,
        status: 'SUCCESS',
        statusCode: '0',
    });

    console.log(`PASS: Account ${accountId} created`);

    // OPEN ACCOUNT
    await page.goto(`${uiUrl}/dashboard/me`);
    await page.getByRole('button', { name: 'Customer Hub' }).click();
    await page.getByRole('link', { name: 'Customer Management' }).first().click();

    await page.locator('.form-group').first().getByRole('textbox').fill(accountId);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('link', { name: accountId, exact: true }).click();

    await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
    await page.locator('a').filter({ hasText: 'Assets' }).click();
    await page.getByRole('link', { name: ' Services' }).click();

    await expect(page.getByRole('cell', { name: orderId, exact: true })).toBeVisible();

    // CREATE ORDER
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

    // PROVISIONING DATA
    await page.getByRole('button', { name: 'View' }).click();
    await page.getByRole('button', { name: '+Add' }).click();

    const emptyCells = page.getByRole('cell').filter({ hasText: /^$/ });

    await emptyCells.nth(4).click();
    await page.locator('input[id^="text-"]:visible').first().fill(provisioningId);

    await emptyCells.nth(5).click();
    await page.locator('input[id^="text-"]:visible').last().fill(ontModel);

    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await page.getByRole('button', { name: 'Next' }).first().click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText('Create Order successfully!')).toBeVisible();

    // MANUAL PROVISIONING
    await queryDatabase(`
    UPDATE core_oms."order"
    SET status = 'PROVISIONING_ERROR'
    WHERE id = $1
  `, [orderId]);

    await queryDatabase(`
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
  `, [orderId]);

    await queryDatabase(`
    UPDATE core_oms.order_provisioning_inputs
    SET status = 'COMPLETED'
    WHERE id = $1
  `, [orderId]);

    // SUBMIT ORDER
    await page.goto(`${uiUrl}/customers/${accountId}/services`);
    await page.waitForTimeout(5000);
    await page.getByRole('button', { name: 'Submit order' }).click();

    // VERIFY ACTIVE
    let active = false;

    for (let i = 1; i <= 10; i++) {
        await page.waitForTimeout(5000);
        await page.getByRole('button', { name: 'Refresh' }).click();

        if (await page.getByRole('cell', { name: 'ACTIVE', exact: true }).first().isVisible().catch(() => false)) {
            active = true;
            break;
        }
    }

    expect(active, `${accountId} never reached ACTIVE`).toBe(true);

    console.log(`PASS: Environment test complete — ${accountId} ACTIVE`);
});