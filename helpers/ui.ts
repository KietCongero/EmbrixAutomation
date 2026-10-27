import { expect, Page } from '@playwright/test';
import { env } from '../config/environments';

// Login and the Customer Hub navigation every spec starts with.

export const login = async (page: Page) => {
    if (!env.username || !env.password) throw new Error('Missing EMBRIX_USERNAME or EMBRIX_PASSWORD');

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(env.username);
    await page.getByRole('textbox', { name: 'Password' }).fill(env.password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('PASS: Login successful');
};

export const openAccount = async (page: Page, accountId: string) => {
    await page.goto('/dashboard/me');
    await page.getByRole('button', { name: 'Customer Hub' }).click();
    await page.getByRole('link', { name: 'Customer Management' }).first().click();

    const accountSearch = page.locator('.form-group').first().getByRole('textbox');

    await accountSearch.fill(accountId);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('link', { name: accountId, exact: true })).toBeVisible();
    await page.getByRole('link', { name: accountId, exact: true }).click();

    console.log(`PASS: Account ${accountId} opened`);
};

// Subscription Data > Assets > Services (active services + In-complete Orders)
export const openServices = async (page: Page, accountId: string) => {
    await openAccount(page, accountId);
    await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
    await page.locator('a').filter({ hasText: 'Assets' }).click();
    await page.getByRole('link', { name: ' Services' }).click();
};

export const openBills = async (page: Page, accountId: string) => {
    await page.goto(`/customers/${accountId}/bills`);
};

export const openCustomerActivity = async (page: Page, accountId: string) => {
    await openAccount(page, accountId);
    await page.locator('a').filter({ hasText: 'Account Data' }).click();
    await page.getByRole('link', { name: /Customer Activity/ }).click();
    await page.getByRole('button', { name: 'Clear' }).click();
    await page.getByRole('button', { name: 'Search' }).click();
};

export type ServiceStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

// Polls the Services table until a cell with the expected status shows up.
export const verifyServiceStatus = async (page: Page, accountId: string, expectedStatus: ServiceStatus, attempts = 10) => {
    await openServices(page, accountId);

    console.log(`Checking for ${expectedStatus} service...`);

    for (let attempt = 1; attempt <= attempts; attempt++) {
        const status = page.getByRole('cell', { name: expectedStatus, exact: true }).first();

        if (await status.isVisible().catch(() => false)) {
            console.log(`PASS: Service for ${accountId} is ${expectedStatus}`);
            return;
        }

        await page.waitForTimeout(5000);
        await page.getByRole('button', { name: 'Refresh' }).click();
    }

    throw new Error(`Service ${accountId} did not reach ${expectedStatus}`);
};
