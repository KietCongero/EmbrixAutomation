import { test, expect } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';

test('TC09 - modify IPTV package and TV ADIC', async ({ request }) => {
    test.setTimeout(5 * 60 * 1000);

    const apiToken = process.env.EMBRIX_API_TOKEN;

    const apiUrl = 'https://crm-gateway.coopegsbx.embrix.org/processAccountAndOrder';

    const accountId = ACCOUNT_ID;

    if (!apiToken) throw new Error('Missing EMBRIX_API_TOKEN');

    // ============================================================
    // HELPER - RUN MODIFY PAYLOAD
    // ============================================================

    const runModifyPayload = async (payload: any, label: string) => {
        console.log('================================================');
        console.log(label);
        console.log('Account:', accountId);
        console.log('Order:', payload.orderId);
        console.log('================================================');

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
            `${label} HTTP request failed: ${response.status()} ${responseText}`
        ).toBeTruthy();

        let responseBody;

        try {
            responseBody = JSON.parse(responseText);
        } catch {
            throw new Error(
                `${label} returned non-JSON response: ${responseText}`
            );
        }

        if (responseBody.status === 'FAILED') {
            throw new Error(
                `${label} failed: ${responseBody.errorCode || 'UNKNOWN'} - ${responseBody.errorMsg || responseText}`
            );
        }

        expect(responseBody.status).toBe('SUCCESS');
        expect(responseBody.statusCode).toBe('0');

        console.log(`PASS: ${label}`);

        return responseBody;
    };

    // ============================================================
    // MODIFY #1
    //
    // ADD:
    // PKG_IPTV_STANDARD
    // BDL_TV_ADIC quantity 2
    // ============================================================

    const firstModifyPayload = {
        userId: 'KCONG',
        accountId,
        orderType: 'MODIFY',
        billOrderCharges: 'false',
        staticIpRented: 'false',
        orderId: `MODI${accountId}A`,
        services: [
            {
                bundleId: 'BDL_TV_ADIC',
                packageId: '',
                serviceType: 'IPTV',
                action: 'ADD',
                quantity: '2',
            },
            {
                bundleId: 'BDL_IPTV',
                packageId: 'PKG_IPTV_STANDARD',
                serviceType: 'INTERNET',
                action: 'ADD',
                quantity: '1',
            },
            {
                bundleId: 'BDL_TV_IND',
                packageId: 'PKG_IPTV_STANDARD',
                serviceType: 'IPTV',
                action: 'ADD',
                quantity: '1',
            },
        ],
    };

    await runModifyPayload(
        firstModifyPayload,
        'MODIFY #1 - Add IPTV Standard + TV ADIC quantity 2'
    );

    // ============================================================
    // MODIFY #2
    //
    // REDUCE TV ADIC FROM 2 -> 1
    //
    // This requires the instanceId of the existing BDL_TV_ADIC.
    // Example:
    // MODI9000141:B:BDL_TV_ADIC-4
    // ============================================================

    const tvAdicInstanceId = process.env.TV_ADIC_INSTANCE_ID;

    if (!tvAdicInstanceId) {
        console.log('================================================');
        console.log('MODIFY #2 NOT RUN');
        console.log('Missing TV_ADIC_INSTANCE_ID');
        console.log('MODIFY #1 completed successfully');
        console.log('Set TV_ADIC_INSTANCE_ID before running MODIFY #2');
        console.log('================================================');

        return;
    }

    const secondModifyPayload = {
        userId: 'KCONG',
        accountId,
        orderType: 'MODIFY',
        billOrderCharges: 'false',
        staticIpRented: 'false',
        orderId: `MODI${accountId}B`,
        services: [
            {
                bundleId: 'BDL_TV_ADIC',
                packageId: '',
                serviceType: 'IPTV',
                action: 'CANCEL',
                quantity: '1',
                instanceId: tvAdicInstanceId,
            },
        ],
    };

    await runModifyPayload(
        secondModifyPayload,
        'MODIFY #2 - Reduce TV ADIC quantity 2 -> 1'
    );

    console.log('================================================');
    console.log('TC09 MODIFY PAYLOADS PASSED');
    console.log(`Account: ${accountId}`);
    console.log('MODIFY #1: IPTV Standard + TV ADIC quantity 2');
    console.log('MODIFY #2: TV ADIC reduced to quantity 1');
    console.log('================================================');
});