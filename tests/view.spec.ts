import { test, expect } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import { env } from '../config/environments';

test('record collection flow', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const username = env.username;
    const password = env.password;
    const accountId = ACCOUNT_ID;

    if (!username || !password) throw new Error('Missing username or password');

    // ============================================================
    // LOGIN
    // ============================================================

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('PASS: Login successful');

    await page.pause();
});