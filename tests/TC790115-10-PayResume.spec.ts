import { test } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import { login, verifyServiceStatus, getOutstandingInvoices, payAllOutstandingInvoices, processOrder, readInvoices, logInvoices } from '../helpers';

// 790115 TC-10 (and TC-20, same flow): full payment with the account suspended -> automatic
// RESUME order -> services ACTIVE. Same as TC08 step 4, except the sheet pays every open invoice
// in one applyPayment call (R03) instead of the oldest one only.

test('790115 TC-10 - pay open invoices while suspended and process the RESUME order', async ({ page, request }) => {
    test.setTimeout(15 * 60 * 1000);

    const accountId = ACCOUNT_ID;

    await login(page);

    // 1. SERVICES MUST BE SUSPENDED
    await verifyServiceStatus(page, accountId, 'SUSPENDED');

    // 2. PAY EVERY OPEN INVOICE IN ONE REQUEST, WAIT FOR CLOSED
    // (nothing outstanding = a previous run already paid; go straight to the RESUME order)
    const outstanding = await getOutstandingInvoices(page, accountId);
    const paid = outstanding.length > 0 ? await payAllOutstandingInvoices(page, request, accountId) : [];

    if (paid.length === 0) console.log('No outstanding invoices: already paid, processing the RESUME order only');

    // 3. AUTOMATIC RESUME ORDER: FIND, COMPLETE PROVISIONING, SUBMIT, VERIFY ACTIVE
    console.log('Waiting for automatic RESUME order...');
    await page.waitForTimeout(5000);

    const resumeOrderId = await processOrder(page, accountId, 'RESUME');

    logInvoices(await readInvoices(page, accountId), 'INVOICES AFTER PAYMENT');

    console.log('================================================');
    console.log('PASS: INVOICES PAID AND SERVICE RECONNECTED');
    console.log(`Account: ${accountId}`);
    console.log(`Paid Invoices: ${paid.map(invoice => `${invoice.invoiceId} (${invoice.due})`).join(', ')}`);
    console.log(`Resume Order: ${resumeOrderId}`);
    console.log('Service Status: ACTIVE');
    console.log('================================================');
});
