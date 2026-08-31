import { test, expect } from '@playwright/test';

test('check INVOICE_CHECK error', async ({ page }) => {
    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;

    const targetDate = '2026-11-01';

    if (!username || !password) {
        throw new Error('Missing username or password');
    }

    // Login
    await page.goto('https://core-ui.demo.embrix.org/login');

    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('PASS: Login successful');

    // Operations Hub -> Jobs Management -> DAILY
    await page.getByRole('button', { name: 'Operations Hub' }).click();
    await page.getByRole('link', { name: 'Jobs Management' }).click();

    await page
        .locator('#sidebarnav a')
        .filter({ hasText: 'Jobs Management' })
        .click();

    await page.getByRole('link', { name: ' DAILY' }).click();

    // Enter date
    const dateInput = page.getByRole('textbox').first();

    await dateInput.click();
    await dateInput.press('ControlOrMeta+a');
    await dateInput.fill(targetDate);
    await dateInput.press('Escape');

    console.log(`Checking jobs for ${targetDate}...`);

    // Refresh jobs
    await page.getByTitle('Refresh jobs').click();

    await page.waitForTimeout(2000);

    // Confirm INVOICE_CHECK is on the page
    await expect(
        page.getByRole('heading', { name: 'INVOICE_CHECK' })
    ).toBeVisible();

    console.log('PASS: INVOICE_CHECK found');

    // Check for ERROR status
    const invoiceError = page.getByTitle('Status: ERROR');

    await expect(invoiceError).toBeVisible({
        timeout: 10000,
    });

    console.log(`PASS: INVOICE_CHECK is ERROR for ${targetDate}`);
});