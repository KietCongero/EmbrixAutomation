import { test, expect } from '@playwright/test';
import accountTemplate from '../test-data/tc01-account.json';
import { allocateTestAccount } from '../helpers/accounts';
import { env } from '../config/environments';

test('TC-01 - create account and verify incomplete order', async ({ request, page }) => {
    const apiUrl = env.api.processAccountAndOrder;
    const apiToken = env.apiToken;
    const username = env.username;
    const password = env.password;
    const { accountId, orderId } = await allocateTestAccount();

    if (!apiUrl || !apiToken) throw new Error('Missing API URL or token');
    if (!username || !password) throw new Error('Missing username or password');

    const payload = { ...accountTemplate, accountId, orderId };

    console.log(`Creating account ${accountId}...`);

    const response = await request.post(apiUrl, {
        headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
        },
        data: payload,
    });

    const responseText = await response.text();

    console.log('Response status:', response.status());
    console.log('Response body:', responseText);

    expect(
        response.ok(),
        `API failed with ${response.status()}: ${responseText}`
    ).toBeTruthy();

    let responseBody;

    try {
        responseBody = JSON.parse(responseText);
    } catch {
        throw new Error(
            `API returned non-JSON content: ${responseText.slice(0, 500)}`
        );
    }

    expect(responseBody).toEqual({
        accountId,
        orderId,
        status: 'SUCCESS',
        statusCode: '0',
    });

    console.log('Account created successfully:', responseBody);
    console.log('Logging into Embrix...');

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);
    console.log('Login successful');

    await page.getByRole('button', { name: 'Customer Hub' }).click();
    await page.getByRole('link', { name: 'Customer Management' }).click();

    console.log(`Searching for account ${accountId}...`);

    await page.locator('.form-group').first().getByRole('textbox').fill(accountId);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('link', { name: accountId, exact: true }).click();

    console.log(`Account ${accountId} found`);

    await page.getByText('Subscription Data').click();
    await page.getByText('Assets').click();
    await page.getByRole('link', { name: ' Services' }).click();

    console.log(`Opening order ${orderId}...`);

    await page.getByRole('cell', { name: orderId }).click();

    await expect(page.getByRole('button', { name: '   Subscription: null' })).toBeVisible();


    console.log(`PASS: Order ${orderId} was created as an incomplete order`);
});