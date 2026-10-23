
import { test, expect } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import { env } from '../config/environments';

test('TC16 - GraphQL billing and generate invoice', async ({ page }) => {
    test.setTimeout(5 * 60 * 1000);

    const username = env.username;
    const password = env.password;
    const accountId = ACCOUNT_ID;

    if (!username || !password) throw new Error('Missing credentials');

    // LOGIN
    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    // OPEN BILLS
    const openBills = async () => {
        await page.goto('/dashboard/me');
        await page.getByRole('button', { name: 'Customer Hub' }).click();
        await page.getByRole('link', { name: 'Customer Management' }).first().click();
        await page.locator('.form-group').first().getByRole('textbox').fill(accountId);
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.getByRole('link', { name: accountId, exact: true }).click();
        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();
    };

    // GET NEXT PENDING BILL
    await openBills();

    const pendingRow = page.getByRole('row').filter({
        has: page.getByRole('cell', { name: 'PENDING', exact: true })
    }).first();

    await expect(pendingRow).toBeVisible();

    const dateCells = pendingRow.getByRole('cell').filter({ hasText: /^\d{4}-\d{2}-\d{2}$/ });
    const startDate = (await dateCells.nth(0).innerText()).trim();
    const endDate = (await dateCells.nth(1).innerText()).trim();

    console.log(`Billing period: ${startDate} -> ${endDate}`);

    // GRAPHQL




    const runGraphql = async (mutation: string, expectedText: string) => {
        const maxAttempts = mutation.includes('setCcpTime') ? 3 : 1;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            console.log(`GraphQL attempt ${attempt}/${maxAttempts}: ${expectedText}`);

            await page.goto(env.graphiqlUrl);

            await page.evaluate((query) => {
                const editorElement = document.querySelector('.CodeMirror');
                const codeMirror = (editorElement as any)?.CodeMirror;

                if (!codeMirror) throw new Error('CodeMirror editor not found');

                codeMirror.setValue(query);
                codeMirror.focus();
            }, mutation);

            await page.waitForTimeout(1000);
            await page.getByRole('button', { name: 'Execute Query (Ctrl-Enter)' }).click();

            try {
                await expect(page.locator('pre').filter({ hasText: expectedText })).toBeVisible({ timeout: 5000 });
                console.log(`PASS: GraphQL executed - ${expectedText}`);
                return;
            } catch (error) {
                if (attempt === maxAttempts) throw error;
                console.log(`WARNING: No matching response. Retrying GraphQL...`);
                await page.waitForTimeout(2000);
            }
        }
    };



    // SET CCP TIME
    await runGraphql(`mutation {
    setCcpTime(input: {
        ccpTime: "${endDate}"
    }) {
        ccpTime
    }
}`, `"ccpTime": "${endDate}"`);

    // RUN BILLING
    await runGraphql(`mutation {
    runBilling(input: {
        accountId: "${accountId}"
    }) {
        id
        billTotal
        total
        status
        startDate
        endDate
    }
}`, '"runBilling"');

    console.log('PASS: Billing mutation completed');


    // 3. GENERATE INVOICE
    await openBills();

    const billRow = page.getByRole('row')
        .filter({ hasText: startDate })
        .filter({ hasText: endDate })
        .first();

    await expect(billRow).toBeVisible();

    const values = (await billRow.getByRole('cell').allInnerTexts()).map(value => value.trim());

    console.log(`Selected bill: ${startDate} -> ${endDate}`);
    console.log('Bill row:', values);

    // Select the bill using the row's selection control
    await billRow.locator('input[name="select"]').locator('..').click();

    // Generate invoice
    await page.getByText('Action <Select Action>').click();
    await page.getByText('GENERATE_INVOICE', { exact: true }).click();

    await page.getByRole('button', { name: 'Submit', exact: true }).click();

    await expect(page.getByText('Invoiced Account successfully!')).toBeVisible({ timeout: 60000 });

    console.log(`PASS: Invoice generated for ${startDate} -> ${endDate}`);

});
