
import { test, expect } from '@playwright/test';

import { randomBytes } from 'node:crypto';
import accountTemplate from '../test-data/tc14-account.json';
import { allocateTestAccount } from '../helpers/accounts';
import { queryDatabase } from '../helpers/database';
import { env } from '../config/environments';

test('TC14 - create intercompany account, validate account information, and provision service', async ({ request, page }) => {
  test.setTimeout(20 * 60 * 1000);

  // ============================================================
  // CONFIG
  // ============================================================

  const apiUrl = env.api.processAccountAndOrder;
  const apiToken = env.apiToken;
  const username = env.username;
  const password = env.password;

  const { accountId, orderId } = await allocateTestAccount();

  const provisioningId = env.provisioningId;
  const ontModel = env.ontModel;

  if (!apiUrl || !apiToken) throw new Error('Missing EMBRIX_API_URL or EMBRIX_API_TOKEN');
  if (!username || !password) throw new Error('Missing EMBRIX_USERNAME or EMBRIX_PASSWORD');

  console.log('================================================');
  console.log('TC14 - INTERCOMPANY ACCOUNT');
  console.log(`ACCOUNT: ${accountId}`);
  console.log(`ORDER: ${orderId}`);
  console.log(`PROVISIONING ID: ${provisioningId}`);
  console.log('================================================');

  // ============================================================
  // 1. CHECK PROVISIONING ID
  // ============================================================

  console.log(`Checking provisioning ID ${provisioningId}...`);

  const oldOrderRows = await queryDatabase(`
    SELECT *
    FROM core_oms.order_service_provisions
    WHERE provisioningid = $1
  `, [provisioningId]);

  if (oldOrderRows.length > 0) {
    const randomProvisioningId = `TEST_${randomBytes(6).toString('hex').toUpperCase()}`;

    console.log(`Provisioning ID ${provisioningId} is used by ${oldOrderRows.length} old order row(s).`);
    console.log(`Changing old provisioning ID to ${randomProvisioningId}...`);

    await queryDatabase(`
      UPDATE core_oms.order_service_provisions
      SET provisioningid = $1
      WHERE provisioningid = $2
    `, [randomProvisioningId, provisioningId]);

    console.log(`PASS: Old provisioning ID changed to ${randomProvisioningId}`);
  }

  const activeRows = await queryDatabase(`
    SELECT provisioningid, ratingprovisioningid, enddate
    FROM core_engine.service_provision
    WHERE provisioningid = $1
      AND enddate IS NULL
  `, [provisioningId]);

  if (activeRows.length > 0) {
    const ratingIds = activeRows.map(row => row.ratingprovisioningid).join(', ');

    throw new Error(
      `Provisioning ID ${provisioningId} is still active. ` +
      `Cancel subscription(s) with ratingProvisioningId: ${ratingIds}`
    );
  }

  console.log(`PASS: Provisioning ID ${provisioningId} is free`);

  // ============================================================
  // 2. CREATE ACCOUNT THROUGH API
  // ============================================================

  const payload = { ...accountTemplate, accountId, orderId };

  console.log(`Creating intercompany account ${accountId}...`);

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

  expect(response.ok(), `API failed with ${response.status()}: ${responseText}`).toBeTruthy();

  let responseBody;

  try {
    responseBody = JSON.parse(responseText);
  } catch {
    throw new Error(`API returned non-JSON content: ${responseText.slice(0, 500)}`);
  }

  expect(responseBody).toEqual({
    accountId,
    orderId,
    status: 'SUCCESS',
    statusCode: '0',
  });

  console.log(`PASS: Intercompany account ${accountId} created`);
  console.log(`PASS: Incomplete order ${orderId} created`);

  // ============================================================
  // 3. VALIDATE ASSOCIATED PACKAGE IN DATABASE
  // ============================================================

  console.log(`Checking associated package for order ${orderId}...`);

  const services = await queryDatabase(`
    SELECT *
    FROM core_oms.order_services
    WHERE id = $1
  `, [orderId]);

  console.log('Order services:', services);

  expect(services).toHaveLength(2);

  expect(services).toEqual(expect.arrayContaining([
    expect.objectContaining({
      bundleid: 'BDL_INT_100MBPS_TEL',
      packageid: 'PKG_INT_100MBPS_TELANAG',
      servicetype: 'INTERNET',
      action: 'ADD',
      status: 'CREATED',
    }),
    expect.objectContaining({
      bundleid: 'BDL_TELANAG',
      packageid: 'PKG_INT_100MBPS_TELANAG',
      servicetype: 'VOIP',
      action: 'ADD',
      status: 'CREATED',
    }),
  ]));

  console.log('PASS: INTERNET bundle and package verified');
  console.log('PASS: VOIP bundle and package verified');

  // ============================================================
  // 4. LOGIN TO EMBRIX
  // ============================================================

  console.log('Logging into Embrix...');

  await page.goto('/login');

  await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

  console.log('PASS: Login successful');

  // ============================================================
  // 5. OPEN CREATED ACCOUNT
  // ============================================================

  await page.getByRole('button', { name: 'Customer Hub' }).click();
  await page.getByRole('link', { name: 'Customer Management' }).first().click();

  console.log(`Searching for account ${accountId}...`);

  const accountSearch = page.locator('.form-group').first().getByRole('textbox');

  await accountSearch.fill(accountId);
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(page.getByRole('link', { name: accountId, exact: true })).toBeVisible();

  await page.getByRole('link', { name: accountId, exact: true }).click();

  console.log(`PASS: Account ${accountId} opened`);

  // ============================================================
  // 6. VALIDATE ACCOUNT TYPE = INTERCOMPANY
  // ============================================================

  console.log('Checking Account Type...');

  await page.goto(`/customers/${accountId}/info`);

  const accountType = page.locator('div').filter({ hasText: /^INTERCOMPANY$/ }).nth(2);

  await expect(accountType).toBeVisible();
  await expect(accountType).toHaveText('INTERCOMPANY');

  console.log('PASS: Account Type = INTERCOMPANY');

  // ============================================================
  // 7. VERIFY CUSTOMER ACTIVITY
  // ============================================================

  console.log('Checking Customer Activity...');

  await page.getByRole('link', { name: ' Customer Activity' }).click();
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page.getByRole('cell', { name: 'PROCESS_ACCOUNT_AND_ORDER', exact: true }).first()).toBeVisible();

  console.log('PASS: PROCESS_ACCOUNT_AND_ORDER activity found');

  await page.getByRole('button', { name: 'View' }).first().click();
  await page.getByRole('button', { name: 'OK' }).click();

  // ============================================================
  // 8. VERIFY ACCOUNT + INCOMPLETE ORDER
  // ============================================================

  await page.getByRole('button', { name: 'Customer Hub' }).click();
  await page.getByRole('link', { name: 'Customer Management' }).first().click();

  console.log(`Searching for account ${accountId}...`);

  const secondAccountSearch = page.locator('.form-group').first().getByRole('textbox');

  await secondAccountSearch.fill(accountId);
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(page.getByRole('link', { name: accountId, exact: true })).toBeVisible();

  await page.getByRole('link', { name: accountId, exact: true }).click();

  console.log(`PASS: Account ${accountId} found`);

  await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
  await page.locator('a').filter({ hasText: 'Assets' }).click();
  await page.getByRole('link', { name: ' Services' }).click();

  console.log(`Checking incomplete order ${orderId}...`);

  await expect(page.getByRole('cell', { name: orderId, exact: true })).toBeVisible();

  console.log(`PASS: Incomplete order ${orderId} exists`);

  // ============================================================
  // 9. CREATE ORDER FROM INCOMPLETE ORDER
  // ============================================================

  console.log(`Creating order from ${orderId}...`);

  await page.getByRole('button', { name: 'Customer Hub' }).click();
  await page.getByRole('link', { name: 'Order Management' }).click();
  await page.getByRole('link', { name: 'Create new order' }).click();

  await page.locator('input[name="accountId"]').fill(accountId);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.locator('#scrollableDiv').getByRole('button', { name: 'Next' }).click();

  await page.getByText('Reference Order', { exact: true }).click();
  await page.locator('.group-flex > div:nth-child(5)').click();

  await expect(page.getByRole('cell', { name: orderId, exact: true })).toBeVisible();

  await page.getByRole('cell', { name: orderId, exact: true }).click();
  await page.getByRole('button', { name: 'Select' }).click();

  console.log(`PASS: Reference order ${orderId} selected`);

  // ============================================================
  // 10. ADD INTERNET PROVISIONING DATA
  // ============================================================

  console.log('Opening INTERNET 100 MBPS TELEFONIA provisioning bundle...');

  await page.getByRole('heading', { name: 'Service Type: INTERNET' }).click();

  const internetBundleRow = page.getByRole('row').filter({
    has: page.getByRole('cell', { name: 'INTERNET 100 MBPS TELEFONIA', exact: true }),
  });

  await expect(internetBundleRow).toBeVisible();

  console.log('PASS: INTERNET 100 MBPS TELEFONIA bundle found');

  await internetBundleRow.getByRole('button', { name: 'View' }).click();

  console.log('Adding ONT provisioning information...');

  await page.getByRole('button', { name: '+Add' }).click();

  const provisioningRow = page.locator('.needs-validation > #scrollableDiv > .table > tbody > tr').last();

  const provisioningIdCell = provisioningRow.locator('td').nth(1);
  const ontModelCell = provisioningRow.locator('td').nth(2);

  await expect(provisioningIdCell).toBeVisible();
  await provisioningIdCell.click();

  const provisioningInput = page.locator('input[id^="text-"]:visible').first();

  await expect(provisioningInput).toBeVisible();
  await provisioningInput.fill(provisioningId);

  await expect(ontModelCell).toBeVisible();
  await ontModelCell.click();

  const ontModelInput = page.locator('input[id^="text-"]:visible').last();

  await expect(ontModelInput).toBeVisible();
  await ontModelInput.fill(ontModel);

  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).first().click();

  console.log(`PASS: INTERNET 100 MBPS TELEFONIA provisioning added - ${provisioningId} / ${ontModel}`);

  // ============================================================
  // 11. CREATE ORDER
  // ============================================================

  console.log(`Submitting creation of order ${orderId}...`);

  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page.getByText('Create Order successfully!')).toBeVisible();

  console.log(`PASS: Order ${orderId} created successfully`);

  // ============================================================
  // 12. MANUAL PROVISIONING
  // ============================================================

  console.log('Starting manual provisioning database changes...');

  await queryDatabase(`
    UPDATE core_oms."order"
    SET status = 'PROVISIONING_ERROR'
    WHERE id = $1
  `, [orderId]);

  await queryDatabase(`
    UPDATE core_oms.order_prov_sequence_list
    SET status = 'COMPLETED'
    WHERE id = $1
  `, [orderId]);

  await queryDatabase(`
    UPDATE core_oms.order_provisioning_inputs
    SET status = 'COMPLETED'
    WHERE id = $1
  `, [orderId]);

  console.log('PASS: Manual provisioning DB changes completed');

  // ============================================================
  // 13. RETURN TO CUSTOMER SERVICES
  // ============================================================

  await page.getByRole('button', { name: 'Customer Hub' }).click();
  await page.getByRole('link', { name: 'Customer Management' }).first().click();

  const finalAccountSearch = page.locator('.form-group').first().getByRole('textbox');

  await finalAccountSearch.fill(accountId);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('link', { name: accountId, exact: true }).click();

  await page.locator('a').filter({ hasText: 'Subscription Data' }).click();
  await page.locator('a').filter({ hasText: 'Assets' }).click();
  await page.getByRole('link', { name: ' Services' }).click();

  // ============================================================
  // 14. SUBMIT ORDER
  // ============================================================

  console.log('Waiting 5 seconds before submitting order...');

  await page.waitForTimeout(5000);

  await page.getByRole('button', { name: 'Submit order' }).click();

  console.log(`PASS: Order ${orderId} submitted`);

  // ============================================================
  // 15. WAIT FOR ACTIVE
  // ============================================================

  let activeFound = false;

  for (let attempt = 1; attempt <= 10; attempt++) {
    console.log(`Checking for ACTIVE status: ${attempt}/10`);

    await page.waitForTimeout(5000);

    await page.getByRole('button', { name: 'Refresh' }).click();

    const activeStatus = page.getByRole('cell', { name: 'ACTIVE', exact: true }).first();

    if (await activeStatus.isVisible().catch(() => false)) {
      activeFound = true;

      console.log(`PASS: Service for ${accountId} is ACTIVE`);

      break;
    }

    console.log('ACTIVE not found. Retrying in 5 seconds...');
  }

  expect(activeFound, `Service for account ${accountId} never reached ACTIVE status`).toBe(true);

  // ============================================================
  // COMPLETE
  // ============================================================

  console.log('================================================');
  console.log('TC14 - ACCOUNT VALIDATION AND PROVISIONING PASSED');
  console.log(`Account: ${accountId}`);
  console.log(`Order: ${orderId}`);
  console.log(`Provisioning ID: ${provisioningId}`);
  console.log('PASS: Account creation');
  console.log('PASS: Associated package');
  console.log('PASS: Account Type = INTERCOMPANY');
  console.log('PASS: Customer Activity');
  console.log('PASS: Order creation');
  console.log('PASS: Manual provisioning flow');
  console.log('PASS: ACTIVE service detected');
  console.log('================================================');
});
