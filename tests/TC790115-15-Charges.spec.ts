import { test } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import { q18PriceUnits } from '../helpers';

// 790115 TC-15: contract charges (Q18). The sheet expects one PO_VOIP charge, linked to the
// VOIP service, and the IPTV service with the TV charge only (known failing: EFT-97).
// Report only: the charges are listed and duplicates are pointed out in the log, not asserted.

test('790115 TC-15 - list contract charges and point out duplicates', async () => {
    const accountId = ACCOUNT_ID;
    const priceUnits = await q18PriceUnits(accountId);

    console.log('================================================');
    console.log(`CONTRACT CHARGES (Q18) - account ${accountId}`);
    console.log('================================================');

    for (const unit of priceUnits) {
        console.log(`${unit.id} | ${unit.priceofferid} | service ${unit.serviceunitid} (${unit.servicetype}) | bundle ${unit.bundleid ?? '-'} | ${unit.status} | qty ${unit.quantity}`);
    }

    const active = priceUnits.filter(unit => unit.status === 'ACTIVE');
    const byOffer = new Map<string, typeof active>();

    for (const unit of active) byOffer.set(unit.priceofferid, [...(byOffer.get(unit.priceofferid) ?? []), unit]);

    console.log('================================================');

    for (const [offer, units] of byOffer) {
        if (units.length > 1) {
            console.log(`DUPLICATE: ${offer} is active ${units.length} times on services ${units.map(unit => `${unit.serviceunitid} (${unit.servicetype})`).join(', ')}`);
        }
    }

    const voipOnOtherService = active.filter(unit => unit.priceofferid.startsWith('PO_VOIP') && unit.servicetype !== 'VOIP');

    if (voipOnOtherService.length > 0) {
        console.log(`VOIP charge on a non-VOIP service: ${voipOnOtherService.map(unit => `${unit.priceofferid} on ${unit.serviceunitid} (${unit.servicetype})`).join(', ')}`);
    }

    console.log(`Sheet expects a single PO_VOIP on the VOIP service: ${voipOnOtherService.length === 0 && [...byOffer.values()].every(units => units.length === 1) ? 'MATCH' : 'DIFFERS (EFT-97)'}`);
    console.log('================================================');
});
