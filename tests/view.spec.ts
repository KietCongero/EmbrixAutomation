import { test, expect } from '@playwright/test';

test('login for recording', async ({ page }) => {
    const username = process.env.OCI_USERNAME;
    const password = process.env.OCI_PASSWORD;
    const accountId = 'TEST1111';

    if (!username || !password) throw new Error('Missing username or password');

    //await page.goto('https://core-ui.demo.embrix.org/login');
    await page.goto('https://core-ui.oc-congero.embrix.org/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('PASS: Login successful');

    await page
        .getByRole('button', { name: 'Customer Hub' })
        .click();

    await page
        .getByRole('link', { name: 'Customer Management' })
        .first()
        .click();

    console.log(`Searching for account ${accountId}...`);

    const accountSearch = page
        .locator('.form-group')
        .first()
        .getByRole('textbox');

    await accountSearch.fill(accountId);

    await page
        .getByRole('button', { name: 'Search', exact: true })
        .click();

    await expect(
        page.getByRole('link', {
            name: accountId,
            exact: true,
        })
    ).toBeVisible();

    await page
        .getByRole('link', {
            name: accountId,
            exact: true,
        })
        .click();

    console.log(`PASS: Account ${accountId} found`);

    await page
        .locator('a')
        .filter({ hasText: 'Subscription Data' })
        .click();

    await page.pause();
});