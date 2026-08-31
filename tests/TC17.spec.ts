import { test, expect } from '@playwright/test';

test('TC17 - filter active offers', async ({ page }) => {
    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;
    const accountId = '9000058';

    if (!username || !password) throw new Error('Missing username or password');

    await page.goto('https://core-ui.demo.embrix.org/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('PASS: Login successful');

    await page.getByRole('button', { name: 'Customer Hub' }).click();
    await page.getByRole('link', { name: 'Customer Management' }).first().click();

    const accountSearch = page.locator('.form-group').first().getByRole('textbox');

    await accountSearch.fill(accountId);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('link', { name: accountId, exact: true }).click();

    console.log(`PASS: Account ${accountId} found`);

    await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
    await page.locator('a').filter({ hasText: 'Assets' }).click();
    await page.getByRole('link', { name: ' offers' }).click();

    console.log('Selecting ACTIVE status...');

    await page.locator('.custom-react-select__value-container').first().click();

    const activeOption = page.locator('[id^="react-select-"][id$="-option-0"]').first();
    await expect(activeOption).toBeVisible();
    await activeOption.click();

    await expect(
        page.locator('div').filter({ hasText: /^ACTIVE$/ }).nth(1)
    ).toBeVisible();

    console.log('PASS: ACTIVE selected');

    await page.getByRole('button', { name: 'Search', exact: true }).click();

    const activeOffers = page.getByRole('cell', { name: 'ACTIVE', exact: true });

    await expect(activeOffers.first()).toBeVisible();

    const activeCount = await activeOffers.count();

    expect(activeCount).toBeGreaterThan(0);

    console.log(`PASS: Found ${activeCount} ACTIVE offer(s)`);
    console.log('PASS: TC17 completed');
});