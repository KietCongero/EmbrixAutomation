
import { test, expect } from '@playwright/test';
import { env } from '../config/environments';

test('Coope sandbox login', async ({ page }) => {
    test.setTimeout(0);

    await page.goto('/login');

    await page.getByRole('textbox', { name: 'Username' }).fill(env.username!);
    await page.getByRole('textbox', { name: 'Password' }).fill(env.password!);

    await page.getByRole('button', { name: 'Login' }).click();

    await page.pause();
});
