import { test, expect } from '@playwright/test';

test('run billing jobs and wait for INVOICE_CHECK error', async ({ page }) => {
    test.setTimeout(10 * 60 * 1000);

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

    // Enter target date ONCE
    const dateInput = page.getByRole('textbox').first();

    await dateInput.click();
    await dateInput.press('ControlOrMeta+a');
    await dateInput.fill(targetDate);
    await dateInput.press('Escape');

    console.log(`Target date selected: ${targetDate}`);

    // Create job schedule
    console.log(`Creating DAILY job for ${targetDate}...`);

    await page
        .getByRole('button', { name: 'Create Job Schedule' })
        .click();

    console.log(`PASS: Job schedule created for ${targetDate}`);

    // Refresh
    await page.getByTitle('Refresh jobs').click();

    await page.waitForTimeout(2000);

    // Process DAILY jobs
    await page.getByRole('button', { name: 'Process' }).click();

    await page.getByRole('button', { name: 'Yes' }).click();

    console.log(`PASS: Started DAILY processing for ${targetDate}`);

    // Wait for jobs to start
    await page.waitForTimeout(10000);

    // Refresh until INVOICE_CHECK reaches ERROR
    let invoiceErrorFound = false;

    for (let attempt = 1; attempt <= 20; attempt++) {
        console.log(`Checking INVOICE_CHECK: ${attempt}/20`);

        await page.getByTitle('Refresh jobs').click();

        // Wait 10 seconds between refreshes
        await page.waitForTimeout(10000);

        const invoiceCheck = page.getByRole('heading', {
            name: 'INVOICE_CHECK',
        });

        if (!(await invoiceCheck.isVisible().catch(() => false))) {
            console.log('INVOICE_CHECK not visible yet...');
            continue;
        }

        const invoiceError = page.getByTitle('Status: ERROR');

        if (await invoiceError.isVisible().catch(() => false)) {
            console.log(`PASS: INVOICE_CHECK reached ERROR for ${targetDate}`);

            invoiceErrorFound = true;
            break;
        }

        console.log('INVOICE_CHECK has not reached ERROR yet...');
    }

    expect(
        invoiceErrorFound,
        `INVOICE_CHECK did not reach ERROR for ${targetDate}`
    ).toBe(true);
});