import { expect, Page } from '@playwright/test';
import { queryDatabase } from './database';
import { openServices, verifyServiceStatus } from './ui';

// SUSPEND / RESUME orders under Subscription Data > Assets > Services > In-complete Orders.
// Provisioning is faked (no Nokia): the order's provisioning steps are set to COMPLETED in the DB
// and the order is submitted from the UI, same as the NEW order in test-1.spec.ts.

export type OrderType = 'SUSPEND' | 'RESUME';

export const getIncompleteOrder = async (page: Page, accountId: string, orderType: OrderType, attempts = 10) => {
    await openServices(page, accountId);

    console.log(`Looking for incomplete ${orderType} order...`);

    await expect(page.getByRole('heading', { name: 'In-complete Orders' })).toBeVisible();

    for (let attempt = 1; attempt <= attempts; attempt++) {
        const orderRow = page.getByRole('row').filter({ hasText: orderType }).filter({ hasText: 'ORD-' }).last();

        if (await orderRow.isVisible().catch(() => false)) {
            const rowText = await orderRow.innerText();
            const orderMatch = rowText.match(/ORD-[A-Za-z0-9-]+/);

            if (!orderMatch) throw new Error(`Could not find ${orderType} order ID: ${rowText}`);

            console.log(`PASS: ${orderType} order found: ${orderMatch[0]}`);
            return orderMatch[0];
        }

        await page.waitForTimeout(5000);
        await page.getByRole('button', { name: 'Refresh' }).click();
    }

    throw new Error(`Could not find incomplete ${orderType} order for account ${accountId}`);
};

export const completeOrderProvisioning = async (orderId: string) => {
    console.log(`Completing provisioning sequence for ${orderId} in the DB...`);

    const sequenceRows = await queryDatabase(`SELECT * FROM core_oms.order_prov_sequence_list WHERE id = $1`, [orderId]);

    if (sequenceRows.length === 0) throw new Error(`No provisioning sequence found for ${orderId}`);

    await queryDatabase(`UPDATE core_oms.order_prov_sequence_list SET status = 'COMPLETED' WHERE id = $1`, [orderId]);

    const remainingRows = await queryDatabase(`SELECT * FROM core_oms.order_prov_sequence_list WHERE id = $1 AND status <> 'COMPLETED'`, [orderId]);

    expect(remainingRows.length, `Provisioning sequence still has non-COMPLETED rows for ${orderId}`).toBe(0);

    console.log(`PASS: Provisioning completed for ${orderId}`);
};

// Find the Embrix-created SUSPEND/RESUME order, complete it, submit it, verify the service status.
export const processOrder = async (page: Page, accountId: string, orderType: OrderType) => {
    const orderId = await getIncompleteOrder(page, accountId, orderType);

    await completeOrderProvisioning(orderId);
    await page.waitForTimeout(3000);
    await expect(page.getByRole('button', { name: 'Submit order' })).toBeVisible();
    await page.getByRole('button', { name: 'Submit order' }).click();
    await verifyServiceStatus(page, accountId, orderType === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE');

    console.log(`PASS: ${orderType} order ${orderId} completed`);

    return orderId;
};

// Manual suspension / reconnection from the Services page (Suspend / Resume link > Create).
export const executeManualOrder = async (page: Page, accountId: string, orderType: OrderType) => {
    await openServices(page, accountId);
    await page.getByRole('link', { name: orderType === 'SUSPEND' ? 'Suspend' : 'Resume', exact: true }).click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    console.log(`PASS: Manual ${orderType} order created`);

    return processOrder(page, accountId, orderType);
};
