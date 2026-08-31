import { test, expect } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';


test('cancel active subscription', async ({ page }) => {
    test.setTimeout(2 * 60 * 1000);

    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;

    const accountId = ACCOUNT_ID;

    if (!username || !password) throw new Error('Missing username or password');

    await page.goto('https://core-ui.demo.embrix.org/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    await page.getByRole('button', { name: 'Customer Hub' }).click();
    await page.getByRole('link', { name: 'Customer Management' }).first().click();

    const search = page.locator('.form-group').first().getByRole('textbox');

    await search.fill(accountId);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('link', { name: accountId, exact: true }).click();

    await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
    await page.locator('a').filter({ hasText: 'Assets' }).click();
    await page.getByRole('link', { name: ' Services' }).click();

    //await page.getByRole('cell', { name: 'ACTIVE', exact: true }).first().click();
    await page.getByRole('link', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: 'Submit order' }).click();

    await page.goto(`https://core-ui.demo.embrix.org/customers/${accountId}/services`);

    for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(5000);
        await page.getByRole('button', { name: 'Refresh' }).click();

        if (await page.getByRole('cell', { name: 'CLOSED', exact: true }).first().isVisible().catch(() => false)) {
            console.log('PASS: Subscription cancelled');
            return;
        }
    }

    throw new Error('Subscription never reached CLOSED');
});