import { test, expect } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';

test('TC07 - open collection invoice for recording', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;
    const accountId = ACCOUNT_ID;

    if (!username || !password) {
        throw new Error('Missing EMBRIX_USERNAME or EMBRIX_PASSWORD');
    }

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
    // OPEN COLLECTIONS
    // ============================================================

    await page.getByRole('button', { name: 'AR Hub' }).click();
    await page.getByRole('link', { name: 'Collections' }).click();

    console.log('PASS: Collections page opened');

    // ============================================================
    // SEARCH ACCOUNT
    // ============================================================

    const collectionSearch = page
        .locator('.form-group')
        .first()
        .getByRole('textbox');

    await collectionSearch.fill(accountId);

    console.log(`Searching Collections for account ${accountId}...`);

    // ============================================================
    // WAIT UNTIL COLLECTION INVOICE APPEARS
    // ============================================================

    let collectionFound = false;

    for (let attempt = 1; attempt <= 10; attempt++) {
        console.log(`Collection search attempt ${attempt}/10`);

        await page.getByRole('button', { name: 'Search', exact: true }).click();

        await page.waitForTimeout(5000);

        const viewButton = page
            .getByRole('cell', { name: 'View', exact: true })
            .first();

        if (await viewButton.isVisible().catch(() => false)) {
            console.log(`PASS: Collection invoice found for account ${accountId}`);

            await viewButton.click();

            collectionFound = true;

            break;
        }

        console.log('Collection invoice not found yet. Searching again...');
    }

    expect(
        collectionFound,
        `Could not find collection invoice for account ${accountId}`
    ).toBe(true);

    // ============================================================
    // PAUSE HERE FOR PLAYWRIGHT RECORDING
    // ============================================================

    console.log('================================================');
    console.log('COLLECTION INVOICE OPENED');
    console.log(`Account: ${accountId}`);
    console.log('Playwright is paused - record the next steps now');
    console.log('================================================');

    await page.pause();
});