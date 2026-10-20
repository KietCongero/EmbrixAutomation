
import { test, expect } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';

test('TC08 - Read invoice rows without payment', async ({ page }) => {
    test.setTimeout(2 * 60 * 1000);

    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;
    const accountId = ACCOUNT_ID;

    if (!username || !password) throw new Error('Missing credentials');

    await page.goto('https://core-ui.demo.embrix.org/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    await page.goto(`https://core-ui.demo.embrix.org/customers/${accountId}/bills`);

    await expect(page.getByRole('cell', { name: /^\d{6}$/ }).first()).toBeVisible();

    const rows = page.getByRole('row');
    const count = await rows.count();

    console.log('================================================');
    console.log(`ACCOUNT: ${accountId}`);
    console.log(`VISIBLE ROWS: ${count}`);
    console.log('================================================');

    for (let i = 0; i < count; i++) {
        const cells = rows.nth(i).getByRole('cell');
        const values = await cells.allInnerTexts();

        if (values.length === 0) continue;

        console.log(`ROW ${i}: ${JSON.stringify(values.map(value => value.trim()))}`);
    }

    console.log('================================================');
    console.log('READ COMPLETE - NO PAYMENT EXECUTED');
    console.log('================================================');
});
