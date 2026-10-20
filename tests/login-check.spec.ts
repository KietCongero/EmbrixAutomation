
import { test, expect } from '@playwright/test';

test('Coope sandbox login', async ({ page }) => {
    test.setTimeout(0);

    await page.goto('https://core-ui.coopegsbx2.embrix.org/login');

    await page.getByRole('textbox', { name: 'Username' }).fill(process.env.EMBRIX_USERNAME!);
    await page.getByRole('textbox', { name: 'Password' }).fill(process.env.EMBRIX_PASSWORD!);

    await page.getByRole('button', { name: 'Login' }).click();

    await page.pause();
});
