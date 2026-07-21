import { test, expect } from '@playwright/test';
import accountTemplate from '../test-data/tc01-account.json';
import { ACCOUNT_ID, ORDER_ID } from '../test-data/testIds';

/*
const ACCOUNT_ID = '9000002';
const ORDER_ID = `ORD${ACCOUNT_ID}`;
*/

test('TC-01 - create account and verify incomplete order', async ({ request, page }) => {
    const apiUrl = process.env.EMBRIX_API_URL;
    const apiToken = process.env.EMBRIX_API_TOKEN;
    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;

    if (!apiUrl || !apiToken) throw new Error('Missing API URL or token');
    if (!username || !password) throw new Error('Missing username or password');

    const payload = { ...accountTemplate, accountId: ACCOUNT_ID, orderId: ORDER_ID };

    console.log(`Creating account ${ACCOUNT_ID}...`);

    const response = await request.post(apiUrl, {
        headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
        },
        data: payload,
    });

    const responseBody = await response.json();

    expect(response.ok()).toBeTruthy();
    expect(responseBody).toEqual({
        accountId: ACCOUNT_ID,
        orderId: ORDER_ID,
        status: 'SUCCESS',
        statusCode: '0',
    });

    console.log('Account created successfully:', responseBody);
    console.log('Logging into Embrix...');

    await page.goto('https://core-ui.demo.embrix.org/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);
    console.log('Login successful');

    await page.getByRole('button', { name: 'Customer Hub' }).click();
    await page.getByRole('link', { name: 'Customer Management' }).click();

    console.log(`Searching for account ${ACCOUNT_ID}...`);

    await page.locator('.form-group').first().getByRole('textbox').fill(ACCOUNT_ID);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('link', { name: ACCOUNT_ID, exact: true }).click();

    console.log(`Account ${ACCOUNT_ID} found`);

    await page.getByText('Subscription Data').click();
    await page.getByText('Assets').click();
    await page.getByRole('link', { name: ' Services' }).click();

    console.log(`Opening order ${ORDER_ID}...`);

    await page.getByRole('cell', { name: ORDER_ID }).click();

    await expect(page.getByRole('button', { name: '   Subscription: null' })).toBeVisible();


    console.log(`PASS: Order ${ORDER_ID} was created as an incomplete order`);
});