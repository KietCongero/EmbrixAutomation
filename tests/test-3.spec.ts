import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import accountTemplate from '../test-data/tc10-account.json';
import { ACCOUNT_ID, ORDER_ID } from '../test-data/testIds';
import { queryDatabase } from '../helpers/database';

test('create account, create order, manually provision, and activate service', async ({ request, page }) => {
  test.setTimeout(20 * 60 * 1000);

  // ============================================================
  // CONFIG
  // ============================================================

  const apiUrl = process.env.EMBRIX_API_URL;
  const apiToken = process.env.EMBRIX_API_TOKEN;
  const username = process.env.EMBRIX_USERNAME;
  const password = process.env.EMBRIX_PASSWORD;

  const accountId = ACCOUNT_ID;
  const orderId = ORDER_ID;
  const provisioningId = 'ALCLB3A97FBA';
  const ontModel = 'G-240W-G';

  if (!apiUrl || !apiToken) throw new Error('Missing EMBRIX_API_URL or EMBRIX_API_TOKEN');
  if (!username || !password) throw new Error('Missing EMBRIX_USERNAME or EMBRIX_PASSWORD');

  console.log('================================================');
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
    WHERE provisioningid = $1 AND enddate IS NULL
  `, [provisioningId]);

  if (activeRows.length > 0) {
    const ratingIds = activeRows.map(row => row.ratingprovisioningid).join(', ');
    throw new Error(`Provisioning ID ${provisioningId} is still active. Cancel subscription(s) with ratingProvisioningId: ${ratingIds}`);
  }

  console.log(`PASS: Provisioning ID ${provisioningId} is free`);

  // ============================================================
  // 2. CREATE ACCOUNT + INCOMPLETE ORDER THROUGH API
  // ============================================================

  const payload = { ...accountTemplate, accountId, orderId };

  console.log(`Creating account ${accountId}...`);

  const response = await request.post(apiUrl, {
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
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

  expect(responseBody).toEqual({ accountId, orderId, status: 'SUCCESS', statusCode: '0' });

  console.log(`PASS: Account ${accountId} created`);
  console.log(`PASS: Incomplete order ${orderId} created`);

  // ============================================================
  // 3. LOGIN
  // ============================================================

  console.log('Logging into Embrix...');

  await page.goto('https://core-ui.demo.embrix.org/login');
  await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

  console.log('PASS: Login successful');

  // ============================================================
  // 4. VERIFY ACCOUNT + INCOMPLETE ORDER
  // ============================================================

  await page.getByRole('button', { name: 'Customer Hub' }).click();
  await page.getByRole('link', { name: 'Customer Management' }).first().click();

  console.log(`Searching for account ${accountId}...`);

  const accountSearch = page.locator('.form-group').first().getByRole('textbox');

  await accountSearch.fill(accountId);
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
  // 5. CREATE ORDER FROM INCOMPLETE ORDER
  // ============================================================

  console.log(`Creating order from ${orderId}...`);

  await page.getByRole('button', { name: 'Customer Hub' }).click();
  await page.getByRole('link', { name: 'Order Management' }).click();
  await page.getByRole('link', { name: 'Create new order' }).click();

  // Account
  await page.locator('input[name="accountId"]').fill(accountId);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.locator('#scrollableDiv').getByRole('button', { name: 'Next' }).click();

  // Reference incomplete order
  await page.getByText('Reference Order', { exact: true }).click();
  await page.locator('.group-flex > div:nth-child(5)').click();
  await expect(page.getByRole('cell', { name: orderId, exact: true })).toBeVisible();
  await page.getByRole('cell', { name: orderId, exact: true }).click();
  await page.getByRole('button', { name: 'Select' }).click();

  console.log(`PASS: Reference order ${orderId} selected`);

  // ============================================================
  // 6. ADD PROVISIONING DATA
  // ============================================================

  console.log('Adding provisioning information...');

  const internetIptvRow = page.getByRole('row').filter({
    has: page.getByRole('cell', { name: 'Internet IPTV', exact: true }),
  });

  await expect(internetIptvRow).toBeVisible();

  await internetIptvRow.getByRole('button', { name: 'View', exact: true }).click();

  console.log('PASS: Opened provisioning for Internet IPTV');
  await page.getByRole('button', { name: '+Add' }).click();

  const provisioningTable = page.locator('.needs-validation #scrollableDiv').last();

  const provisioningRow = provisioningTable.locator('tbody tr').first();

  const provisioningIdCell = provisioningRow.locator('td').nth(1);
  const ontModelCell = provisioningRow.locator('td').nth(2);

  // Provisioning ID
  await provisioningIdCell.click();

  const provisioningInput = page.locator('input[id^="text-"]:visible').first();
  await expect(provisioningInput).toBeVisible();
  await provisioningInput.fill(provisioningId);

  // ONT Model
  await ontModelCell.click();

  const ontModelInput = page.locator('input[id^="text-"]:visible').last();
  await expect(ontModelInput).toBeVisible();
  await ontModelInput.fill(ontModel);

  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).first().click();

  console.log(`PASS: Provisioning data added - ${provisioningId} / ${ontModel}`);

  // ============================================================
  // 7. CREATE ORDER
  // ============================================================

  console.log(`Submitting creation of order ${orderId}...`);

  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText('Create Order successfully!')).toBeVisible();

  console.log(`PASS: Order ${orderId} created successfully`);

  // ============================================================
  // 8. MANUAL PROVISIONING
  // ============================================================

  console.log('Starting manual provisioning database changes...');

  await queryDatabase(`
    UPDATE core_oms."order"
    SET status = 'PROVISIONING_ERROR'
    WHERE id = $1
  `, [orderId]);

  await queryDatabase(`
    UPDATE core_oms.order_prov_sequence_list
    SET status = CASE
      WHEN apiname IN ('GET_LOCATION_DATA', 'GET_SPACE_DATA', 'CREATE_PROVISIONING_ORDER', 'UPDATE_OPERATIVE_STATUS', 'UPDATE_OPTICAL_DATA', 'UPDATE_WORK_ORDER') THEN 'COMPLETED'
      WHEN apiname IN ('CREATE_PROVISION_IPTV_ORDER', 'GET_ACCOUNT_PROVISIONING_DATA', 'UPDATE_PROVISIONING_TEMPLATE_DETAILS') THEN 'SKIPPED'
      ELSE status
    END
    WHERE id = $1
  `, [orderId]);

  await queryDatabase(`
    UPDATE core_oms.order_provisioning_inputs
    SET status = 'COMPLETED'
    WHERE id = $1
  `, [orderId]);

  console.log('PASS: Manual provisioning DB changes completed');

  // ============================================================
  // 9. RETURN TO CUSTOMER SERVICES
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
  // 10. SUBMIT ORDER
  // ============================================================

  console.log('Waiting 5 seconds before submitting order...');

  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Submit order' }).click();

  console.log(`PASS: Order ${orderId} submitted`);

  // ============================================================
  // 11. WAIT FOR ALL 3 SERVICES TO BECOME ACTIVE
  // ============================================================

  let allActive = false;

  for (let attempt = 1; attempt <= 10; attempt++) {
    console.log(`Checking for 3 ACTIVE services: ${attempt}/10`);

    await page.waitForTimeout(5000);
    await page.getByRole('button', { name: 'Refresh' }).click();

    const activeStatuses = page.getByRole('cell', { name: 'ACTIVE', exact: true });
    const activeCount = await activeStatuses.count();

    console.log(`ACTIVE services found: ${activeCount}/3`);

    if (activeCount >= 3) {
      allActive = true;
      console.log(`PASS: All 3 services for ${accountId} are ACTIVE`);
      break;
    }

    console.log('Not all services are ACTIVE yet. Retrying in 5 seconds...');
  }

  expect(
    allActive,
    `Expected 3 ACTIVE services for account ${accountId}`
  ).toBe(true);

  console.log('================================================');
  console.log('FULL PROVISIONING FLOW PASSED');
  console.log(`Account: ${accountId}`);
  console.log(`Order: ${orderId}`);
  console.log(`Provisioning ID: ${provisioningId}`);
  console.log('================================================');
});