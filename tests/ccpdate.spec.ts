import { test, expect } from '@playwright/test';

test('billing setup - get effective date and change CCP time', async ({ page }) => {
    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;

    const accountId = '9000040';

    if (!username || !password) {
        throw new Error('Missing username or password');
    }

    // Login
    await page.goto('https://core-ui.demo.embrix.org/login');

    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('Login successful');

    // Go to customer
    await page.getByRole('button', { name: 'Customer Hub' }).click();
    await page.getByRole('link', { name: 'Customer Management' }).first().click();

    const accountSearch = page.locator('.form-group').first().getByRole('textbox');
    await accountSearch.fill(accountId);

    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('link', { name: accountId, exact: true }).click();

    // Subscription Data -> Assets -> Services
    await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
    await page.locator('a').filter({ hasText: 'Assets' }).click();
    await page.getByRole('link', { name: ' Services' }).click();

    // Find ACTIVE service row
    const activeRow = page
        .getByRole('row')
        .filter({
            has: page.getByRole('cell', {
                name: 'ACTIVE',
                exact: true,
            }),
        })
        .first();

    await expect(activeRow).toBeVisible();

    const rowText = await activeRow.innerText();

    console.log('Active service row:');
    console.log(rowText);

    // Find date in YYYY-MM-DD format
    const dateMatches = rowText.match(/\d{4}-\d{2}-\d{2}/g);

    if (!dateMatches || dateMatches.length === 0) {
        throw new Error(`Could not find effective date in row: ${rowText}`);
    }

    const effectiveDate = dateMatches[0];

    console.log(`Effective date: ${effectiveDate}`);

    // Calculate +1 month
    const [year, month, day] = effectiveDate.split('-').map(Number);

    const targetDateObject = new Date(
        Date.UTC(year, month, day)
    );

    const targetDate = targetDateObject
        .toISOString()
        .slice(0, 10);

    console.log(`Target billing date: ${targetDate}`);

    // Go to GraphiQL
    await page.goto(
        'https://transactional.coopeg.embrix.org/graphiql?'
    );

    const mutation = `mutation {
  setCcpTime(input: {
    ccpTime: "${targetDate}"
  })
  {
    ccpTime
  }
}`;

    // Set GraphQL query directly in CodeMirror
    await page.evaluate((query) => {
        const editorElement = document.querySelector('.CodeMirror');

        const codeMirror = (editorElement as any)?.CodeMirror;

        if (!codeMirror) {
            throw new Error('CodeMirror editor not found');
        }

        codeMirror.setValue(query);
        codeMirror.focus();
    }, mutation);

    await page.waitForTimeout(1000);

    // Execute query
    await page
        .getByRole('button', {
            name: 'Execute Query (Ctrl-Enter)',
        })
        .click();

    // Verify returned CCP time
    await expect(
        page.locator('pre').filter({
            hasText: `"ccpTime": "${targetDate}"`,
        })
    ).toBeVisible();

    console.log(`PASS: CCP time changed to ${targetDate}`);
});