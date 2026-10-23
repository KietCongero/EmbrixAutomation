import { test, expect } from '@playwright/test';
import { env } from '../config/environments';

test('cancel active subscription', async ({ page }) => {
    test.setTimeout(3 * 60 * 1000);

    const username = env.username;
    const password = env.password;

    if (!username || !password) throw new Error('Missing username or password');

    // The account to cancel - look up which account holds the ONT in the DB first (see README).
    const accountId = process.env.CANCEL_ACCOUNT_ID;

    if (!accountId) throw new Error('Set CANCEL_ACCOUNT_ID to the account whose subscription should be cancelled');

    console.log(`Cancelling subscription on ${accountId}`);

    const openCustomerServices = async () => {
        await page.goto('/dashboard/me');
        await page.getByRole('button', { name: 'Customer Hub' }).click();
        await page.getByRole('link', { name: 'Customer Management' }).first().click();

        const search = page.locator('.form-group').first().getByRole('textbox');
        await search.fill(accountId);

        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.getByRole('link', { name: accountId, exact: true }).click();

        console.log(`PASS: Account ${accountId} opened`);

        await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
        await page.locator('a').filter({ hasText: 'Assets' }).click();
        await page.getByRole('link', { name: ' Services' }).click();

        console.log('PASS: Customer Services opened');
    };

    const clickRefresh = async (label: string) => {
        const refreshButton = page.getByRole('button', { name: 'Refresh' });
        await expect(refreshButton).toBeVisible({ timeout: 15000 });
        await refreshButton.click();
        console.log(`PASS: ${label} - Refresh clicked`);
        await page.waitForTimeout(3000);
    };

    const clickSubmitOrder = async (label: string) => {
        const submitButton = page.getByRole('button', { name: 'Submit order', exact: true });

        for (let attempt = 1; attempt <= 6; attempt++) {
            console.log(`${label}: checking Submit order ${attempt}/6`);

            if (await submitButton.isVisible().catch(() => false)) {
                await submitButton.scrollIntoViewIfNeeded();

                if (await submitButton.isEnabled().catch(() => false)) {
                    await submitButton.click();
                    console.log(`PASS: ${label} - Submit order clicked`);
                    await page.waitForTimeout(3000);
                    return;
                }
            }

            await page.waitForTimeout(3000);
        }

        throw new Error(`${label}: Submit order button was not available`);
    };

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('PASS: Login successful');

    await openCustomerServices();

    console.log('Opening cancellation...');

    await page.getByRole('link', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    console.log('PASS: Cancel order created');

    await clickRefresh('Cancel order creation');
    await clickSubmitOrder('Cancel order creation');

    console.log('Returning to customer services...');

    await openCustomerServices();

    await clickSubmitOrder('Incomplete cancel order');
    await clickRefresh('Incomplete cancel order');

    console.log('Waiting for subscription to become CLOSED...');

    for (let attempt = 1; attempt <= 10; attempt++) {
        console.log(`Checking CLOSED status ${attempt}/10`);

        const closedStatus = page.getByRole('cell', { name: 'CLOSED', exact: true }).first();

        if (await closedStatus.isVisible().catch(() => false)) {
            console.log(`PASS: Subscription for ${accountId} cancelled`);
            return;
        }

        await page.waitForTimeout(5000);

        const refreshButton = page.getByRole('button', { name: 'Refresh' });

        if (await refreshButton.isVisible().catch(() => false)) {
            await refreshButton.click();
            await page.waitForTimeout(2000);
        }
    }

    throw new Error(`Subscription for ${accountId} never reached CLOSED`);
});