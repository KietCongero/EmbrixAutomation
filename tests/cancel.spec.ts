import { test, expect } from '@playwright/test';
import { env } from '../config/environments';

test('cancel active subscription', async ({ page }) => {
    test.setTimeout(3 * 60 * 1000);

    const username = env.username;
    const password = env.password;

    if (!username || !password) throw new Error('Missing username or password');

    // The account to cancel - look up which account holds the ONT in the DB first (see README).
    const accountId = process.env.CANCEL_ACCOUNT_ID;

    if (!accountId) throw new Error('Set CANCEL_ACCOUNT_ID to the account whose subscription should be cancelled');

    console.log(`Cancelling subscription on ${accountId}`);

    const openCustomerServices = async () => {
        await page.goto('/dashboard/me');
        await page.getByRole('button', { name: 'Customer Hub' }).click();
        await page.getByRole('link', { name: 'Customer Management' }).first().click();

        const search = page.locator('.form-group').first().getByRole('textbox');
        await search.fill(accountId);

        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.getByRole('link', { name: accountId, exact: true }).click();

        console.log(`PASS: Account ${accountId} opened`);

        await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
        await page.locator('a').filter({ hasText: 'Assets' }).click();
        await page.getByRole('link', { name: ' Services' }).click();

        console.log('PASS: Customer Services opened');
    };

    const clickRefresh = async (label: string) => {
        const refreshButton = page.getByRole('button', { name: 'Refresh' });
        await expect(refreshButton).toBeVisible({ timeout: 15000 });
        await refreshButton.click();
        console.log(`PASS: ${label} - Refresh clicked`);
        await page.waitForTimeout(3000);
    };

    const clickSubmitOrder = async (label: string) => {
        const submitButton = page.getByRole('button', { name: 'Submit order', exact: true });

        for (let attempt = 1; attempt <= 6; attempt++) {
            console.log(`${label}: checking Submit order ${attempt}/6`);

            if (await submitButton.isVisible().catch(() => false)) {
                await submitButton.scrollIntoViewIfNeeded();

                if (await submitButton.isEnabled().catch(() => false)) {
                    await submitButton.click();
                    console.log(`PASS: ${label} - Submit order clicked`);
                    await page.waitForTimeout(3000);
                    return;
                }
            }

            await page.waitForTimeout(3000);
        }

        throw new Error(`${label}: Submit order button was not available`);
    };

    // A pending order blocks the cancellation, so cancel every In-complete Order first.
    const cancelIncompleteOrders = async () => {
        const heading = page.getByRole('heading', { name: 'In-complete Orders' });
        // Only rows below the heading, so the Services table above it is never touched.
        const orderRow = heading.locator('xpath=following::tr[td[contains(., "ORD")]]').first();
        const cancelOrderButton = page.getByRole('button', { name: 'Cancel Order' });

        await expect(heading).toBeVisible();

        for (let attempt = 1; attempt <= 5; attempt++) {
            if (!(await orderRow.isVisible().catch(() => false))) {
                // The panel may be collapsed
                await heading.click();
                await page.waitForTimeout(1000);
            }

            if (!(await orderRow.isVisible().catch(() => false))) {
                console.log('PASS: No in-complete orders');
                return;
            }

            const orderId = (await orderRow.innerText()).match(/ORD[A-Za-z0-9-]+/)?.[0] ?? 'unknown';

            console.log(`Cancelling in-complete order ${orderId}...`);

            await orderRow.getByRole('cell').filter({ hasText: /^\d{4}-\d{2}-\d{2}$/ }).first().click();
            await expect(cancelOrderButton, `Cancel Order not available for ${orderId}`).toBeVisible({ timeout: 10000 });
            await cancelOrderButton.click();
            await page.waitForTimeout(3000);

            console.log(`PASS: In-complete order ${orderId} cancelled`);

            await openCustomerServices();
        }

        throw new Error(`In-complete orders still present on ${accountId} after 5 cancellations`);
    };

    // ============================================================
    // CCP TIME
    // ============================================================

    const runGraphql = async (query: string) => {
        await page.goto(env.graphiqlUrl);

        await page.evaluate((q) => {
            const codeMirror = (document.querySelector('.CodeMirror') as any)?.CodeMirror;

            if (!codeMirror) throw new Error('CodeMirror editor not found');

            codeMirror.setValue(q);
        }, query);

        await page.waitForTimeout(1000);
        await page.getByRole('button', { name: 'Execute Query (Ctrl-Enter)' }).click();

        // Every CodeMirror after the query editor (variables, result); read their full text once a response arrives.
        const readResult = () =>
            page.evaluate(() =>
                [...document.querySelectorAll('.CodeMirror')]
                    .slice(1)
                    .map(editor => (editor as any).CodeMirror?.getValue() ?? '')
                    .join('\n')
            );

        await expect.poll(readResult, { timeout: 15000 }).toContain('"data"');

        return readResult();
    };

    const getCcpTime = async () => {
        const result = await runGraphql('{ getCcpDateTime(dummy: "") { ccpTime } }');
        const ccpTime = result.match(/"ccpTime": "(\d{4}-\d{2}-\d{2})/)?.[1];

        if (!ccpTime) throw new Error(`Could not read CCP time: ${result}`);

        return ccpTime;
    };

    const setCcpTime = async (targetDate: string) => {
        await runGraphql(`mutation {
  setCcpTime(input: {
    ccpTime: "${targetDate}"
  }) {
    ccpTime
  }
}`);

        await expect(page.locator('pre').filter({ hasText: `"ccpTime": "${targetDate}"` })).toBeVisible();
    };

    // The cancel is rejected ("Account is not effective until a future Effective date") while the
    // CCP time is before the subscription's effective date, so move CCP forward first - never back.
    const ensureCcpAtOrAfter = async (effectiveDate: string) => {
        const ccpTime = await getCcpTime();

        console.log(`CCP time ${ccpTime} | Subscription effective ${effectiveDate}`);

        if (ccpTime >= effectiveDate) {
            console.log('PASS: CCP time already on or after effective date');
            return false;
        }

        console.log(`Moving CCP time forward to ${effectiveDate}...`);
        await setCcpTime(effectiveDate);
        console.log(`PASS: CCP time changed to ${effectiveDate}`);

        return true;
    };

    const openCancelForm = async () => {
        await page.getByRole('link', { name: 'Cancel', exact: true }).click();
        await expect(page.getByRole('columnheader', { name: 'Effective Date' })).toBeVisible();
    };

    const getSubscriptionEffectiveDate = async () => {
        const subscriptionRow = page
            .getByRole('heading', { name: 'Subscription', exact: true })
            .locator('xpath=following::tr[td][1]');

        await expect(subscriptionRow).toBeVisible();

        const effectiveDate = (await subscriptionRow.innerText()).match(/\d{4}-\d{2}-\d{2}/)?.[0];

        if (!effectiveDate) throw new Error(`Could not find subscription effective date: ${await subscriptionRow.innerText()}`);

        return effectiveDate;
    };

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('PASS: Login successful');

    await openCustomerServices();
    await cancelIncompleteOrders();

    console.log('Opening cancellation...');

    await openCancelForm();

    const effectiveDate = await getSubscriptionEffectiveDate();

    if (await ensureCcpAtOrAfter(effectiveDate)) {
        // GraphiQL navigated away from the form, so open it again
        await openCustomerServices();
        await openCancelForm();
    }

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const notEffective = page.getByText('Account is not effective until a future Effective date');

    if (await notEffective.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) {
        throw new Error(`Cancel rejected: account not effective yet (subscription effective ${effectiveDate})`);
    }

    console.log('PASS: Cancel order created');

    await clickRefresh('Cancel order creation');
    await clickSubmitOrder('Cancel order creation');

    console.log('Returning to customer services...');

    await openCustomerServices();

    await clickSubmitOrder('Incomplete cancel order');
    await clickRefresh('Incomplete cancel order');

    console.log('Waiting for subscription to become CLOSED...');

    for (let attempt = 1; attempt <= 10; attempt++) {
        console.log(`Checking CLOSED status ${attempt}/10`);

        const closedStatus = page.getByRole('cell', { name: 'CLOSED', exact: true }).first();

        if (await closedStatus.isVisible().catch(() => false)) {
            console.log(`PASS: Subscription for ${accountId} cancelled`);
            return;
        }

        await page.waitForTimeout(5000);

        const refreshButton = page.getByRole('button', { name: 'Refresh' });

        if (await refreshButton.isVisible().catch(() => false)) {
            await refreshButton.click();
            await page.waitForTimeout(2000);
        }
    }

    throw new Error(`Subscription for ${accountId} never reached CLOSED`);
});