import { test, expect } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';

test('record collection flow', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;
    const accountId = ACCOUNT_ID;

    if (!username || !password) throw new Error('Missing username or password');

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

    console.log('PASS: Collections opened');

    // ============================================================
    // SEARCH ACCOUNT
    // ============================================================

    const collectionSearch = page.locator('.form-group').first().getByRole('textbox');

    await collectionSearch.fill(accountId);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.waitForTimeout(3000);

    console.log(`PASS: Searched account ${accountId}`);

    // ============================================================
    // SHOW HOW MANY COLLECTION ROWS EXIST
    // ============================================================

    const viewButtons = page.getByRole('cell', { name: 'View' });
    const viewCount = await viewButtons.count();

    console.log(`Collection View rows found: ${viewCount}`);

    // ============================================================
    // PAUSE HERE AND RECORD MANUALLY
    // ============================================================

    console.log('PAUSED: Use Playwright Inspector to click the correct collection row.');
    console.log('Record how you identify the correct/current collection.');

    await page.pause();
});