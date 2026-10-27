import { test, expect } from '@playwright/test';

import accountTemplate from '../test-data/tc790115-account.json';
import { env } from '../config/environments';
import { allocateTestAccount, readLastRun, saveLastRun, login, openServices } from '../helpers';

// 790115 TC-02 (negative): provision with an ONT that is already registered on another order.
// Same wizard steps as test-790115 (TC-01) on a new account, without renaming the old order rows,
// so the ONT is still held by the previous account's order. The sheet expects the UI to reject the
// order with a duplicate ONT error and no new row to be created.
// The account created here is only for this negative case: the last-run file is restored so the
// downstream specs keep using the provisioned account.

test('790115 TC-02 - the wizard rejects an ONT registered on another order', async ({ request, page }) => {
    test.setTimeout(15 * 60 * 1000);

    const previousRun = readLastRun();
    const { accountId, orderId } = await allocateTestAccount();
    const provisioningId = env.provisioningId;
    const ontModel = env.ontModel;

    if (!env.apiToken) throw new Error('Missing EMBRIX_API_TOKEN');

    console.log('================================================');
    console.log(`ACCOUNT: ${accountId} (negative case only)`);
    console.log(`ORDER: ${orderId}`);
    console.log(`ONT: ${provisioningId} / ${ontModel} - expected to be held by ${previousRun?.orderId ?? 'another order'}`);
    console.log('================================================');

    try {
        // 1. CREATE ACCOUNT + INCOMPLETE ORDER (API)
        await test.step('1 - Create account and incomplete order', async () => {
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
        });

        // 2. LOGIN + VERIFY THE INCOMPLETE ORDER
        await test.step('2 - Verify the incomplete order in the UI', async () => {
            await login(page);
            await openServices(page, accountId);
            await expect(page.getByRole('cell', { name: orderId, exact: true })).toBeVisible();
        });

        // 3. ORDER WIZARD WITH THE SAME ONT
        await test.step('3 - Create the order with the ONT held by another order', async () => {
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

            await page.getByRole('heading', { name: 'Service Type: INTERNET' }).click();

            const internetBundleRow = page.getByRole('row').filter({
                has: page.getByRole('cell', { name: 'NA INTERNET 100 MBPS DUO TVE', exact: true }),
            });

            await expect(internetBundleRow).toBeVisible();
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

            console.log(`Provisioning data added with the held ONT - ${provisioningId} / ${ontModel}`);

            await page.getByRole('button', { name: 'Create', exact: true }).click();
        });

        // 4. EXPECTED: ERROR, NOT "Create Order successfully!"
        await test.step('4 - The order is rejected', async () => {
            const success = page.getByText('Create Order successfully!');
            const errorText = page.getByText(/duplicate|constraint|already|error/i).first();

            await expect(success.or(errorText)).toBeVisible({ timeout: 60000 });

            await page.screenshot({ path: `test-results/tc02-duplicate-ont-${accountId}.png`, fullPage: true });

            const alerts = (await page.getByRole('alert').allInnerTexts()).map(text => text.trim()).filter(Boolean);
            const shown = alerts.length > 0 ? alerts : await errorText.allInnerTexts().catch(() => []);

            console.log('================================================');
            console.log(`Message shown: ${shown.join(' | ') || '(none captured)'}`);
            console.log('================================================');

            await expect(success, 'The order must not be created with an ONT held by another order').not.toBeVisible();

            console.log(`PASS: Order ${orderId} rejected (ONT ${provisioningId} held by ${previousRun?.orderId ?? 'another order'})`);
        });
    } finally {
        if (previousRun) {
            saveLastRun(previousRun.accountId);
            console.log(`Last-run account restored to ${previousRun.accountId}`);
        }
    }
});
