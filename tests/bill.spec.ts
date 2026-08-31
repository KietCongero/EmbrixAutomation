import { test, expect } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';

test('read bill and apply payment', async ({ page, request }) => {
    test.setTimeout(2 * 60 * 1000);

    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;
    const apiToken = process.env.EMBRIX_API_TOKEN;

    const accountId = ACCOUNT_ID;
    const paymentUrl = 'https://crm-gateway.coopegsbx.embrix.org/applyPayment';

    if (!username || !password || !apiToken) throw new Error('Missing environment variables');

    // Login
    await page.goto('https://core-ui.coopegsbx.embrix.org/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    // Open account
    await page.getByRole('button', { name: 'Customer Hub' }).click();
    await page.getByRole('link', { name: 'Customer Management' }).first().click();

    const accountSearch = page.locator('.form-group').first().getByRole('textbox');
    await accountSearch.fill(accountId);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('link', { name: accountId, exact: true }).click();

    // Open bill
    await page.locator('a').filter({ hasText: 'Billing Data' }).click();
    await page.getByRole('link', { name: /Bills/ }).click();
    await page.getByRole('cell', { name: 'View' }).first().click();

    const table = page.getByRole('columnheader', { name: 'Invoice Id' }).locator('xpath=ancestor::table');
    const headers = table.locator('thead th');
    const row = table.locator('tbody tr').first();

    const headerTexts = await headers.allInnerTexts();
    const invoiceIndex = headerTexts.findIndex(x => x.trim() === 'Invoice Id');
    const billTotalIndex = headerTexts.findIndex(x => x.trim() === 'Bill Total');

    const invoiceId = (await row.locator('td').nth(invoiceIndex).innerText()).trim();
    const billTotalText = (await row.locator('td').nth(billTotalIndex).innerText()).trim();
    const billTotal = Number(billTotalText.replace(/,/g, '').replace(/[^\d.-]/g, ''));

    console.log(`Invoice ID: ${invoiceId}`);
    console.log(`Bill Total: ${billTotal}`);

    const response = await request.post(paymentUrl, {
        headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
        },
        data: {
            id: '',
            paymentSourceId: '',
            paymentDate: '',
            paymentSource: 'BCR',
            allocationData: [{
                accountId,
                invoiceId,
                currency: 'CRC',
                amount: billTotal,
            }],
        },
    });

    const body = await response.json();

    console.log(body);

    expect(response.ok()).toBeTruthy();
    expect(body.status).toBe('SUCCESS');
    expect(body.statusCode).toBe('0');

    console.log(`PASS: Paid ${billTotal} CRC to invoice ${invoiceId}`);
});