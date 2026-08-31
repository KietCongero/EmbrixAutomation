import { queryDatabase } from './database';

type ProvisioningRecord = {
    accountid: string;
    provisioningid: string;
    status: string;
};

export async function findProvisioningId(
    provisioningId: string
): Promise<ProvisioningRecord | null> {
    const rows = await queryDatabase<ProvisioningRecord>(
        `
      SELECT accountid, provisioningid, status
      FROM core_engine.service_provision
      WHERE provisioningid = $1
    `,
        [provisioningId]
    );

    return rows[0] ?? null;
}