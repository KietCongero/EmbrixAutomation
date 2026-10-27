import { queryDatabase } from './database';

// Verification SQL from the "Queries" sheet of Test_cases_790115_EN.xlsx (Q01-Q18),
// parameterised by account / order / ONT. Read-only unless the name says otherwise.
//
//   const invoices = await q07BillUnitsAndInvoices(accountId);
//   expect(invoices[0].duedate.endsWith('-18')).toBe(true);

export type OntUsage = { source: 'service' | 'order'; accountid: string; id: string; provisioningid: string };
export type OrderStatus = { id: string; type: string; status: string };
export type ProvisioningStep = { index: number; apiname: string; status: string; retriedcount: number };
export type Subscription = { id: string; status: string; reason: string | null; effectivedate: Date | string };
export type BillingProfile = { billingdom: number; lastbilldate: Date | string | null; nextbilldate: Date | string | null; status: string; pausebilling: boolean; pauseinvoicing: boolean };
export type Invoice = { billunitid: string; invoiceunitid: string | null; startdate: Date | string; enddate: Date | string; billtotal: string | number; due: string | number; invoicedate: Date | string | null; duedate: Date | string | null; invoicestatus: string | null };
export type BillUnit = { id: string; status: string; startdate: Date | string; enddate: Date | string; total: string | number };
export type JobScheduleCheck = { id: string; scheduledate: Date | string; status: string; pending_jobs: number };
export type JobResult = { t: 'error' | 'success'; type: string; status: string; reason: string | null; refid: string | null };
export type CollectionUnit = { invoiceid: string; duedate: Date | string; status: string; daysincollection: number; nextaction: string | null; nextactiondate: Date | string | null };
export type PendingJob = { id: string; type: string; status: string; name: string | null };
export type JobScheduleEntry = { id: string; status: string; index: number; type: string; jobid: string; liststatus: string };
export type EmailNotification = { type: string; status: string; createddate: Date | string };
export type ServiceUnit = { id: string; type: string; status: string; reason: string | null };
export type NonNewOrder = { id: string; type: string; status: string; createddate: Date | string; steps: string | null };
export type Payment = { id: string; amount: string | number; remainingamount: string | number; status: string; paymentdate: Date | string };
export type PriceUnit = { id: string; priceofferid: string; serviceunitid: string; servicetype: string; bundleid: string | null; packageid: string | null; status: string; quantity: number };

// Q01 - ONT in use (service or order)
export const q01OntInUse = (provisioningId: string) =>
    queryDatabase<OntUsage>(
        `
    SELECT 'service' AS source, su.accountid, sp.id, sp.provisioningid
    FROM core_engine.service_provision sp
    JOIN core_engine.service_unit su ON su.id = sp.id
    WHERE sp.provisioningid = $1
    UNION ALL
    SELECT 'order', o.accountid, p.id, p.provisioningid
    FROM core_oms.order_service_provisions p
    JOIN core_oms."order" o ON o.id = p.id
    WHERE p.provisioningid = $1
  `,
        [provisioningId]
    );

// Q02 - Order status
export const q02OrderStatus = async (orderId: string) =>
    (await queryDatabase<OrderStatus>(`SELECT id, type, status FROM core_oms."order" WHERE id = $1`, [orderId]))[0] ?? null;

// Q03 - Provisioning steps
export const q03ProvisioningSteps = (orderId: string) =>
    queryDatabase<ProvisioningStep>(
        `SELECT index, apiname, status, retriedcount FROM core_oms.order_prov_sequence_list WHERE id = $1 ORDER BY index`,
        [orderId]
    );

// Q04 - Subscription
export const q04Subscriptions = (accountId: string) =>
    queryDatabase<Subscription>(`SELECT id, status, reason, effectivedate FROM core_engine.subscription WHERE accountid = $1`, [accountId]);

// Q05 - Billing cycle
export const q05BillingProfile = async (accountId: string) =>
    (
        await queryDatabase<BillingProfile>(
            `SELECT billingdom, lastbilldate, nextbilldate, status, pausebilling, pauseinvoicing FROM core_engine.billing_profile WHERE accountid = $1`,
            [accountId]
        )
    )[0] ?? null;

// Q06 - Release the ONT from another order (sandbox only). WRITES to the DB.
// Renames the serial number on that order so the ONT can be used again.
export const q06ReleaseOntFromOrder = async (orderId: string, provisioningId: string, newProvisioningId: string, serviceType = 'INTERNET') => {
    await queryDatabase(
        `UPDATE core_oms.order_service_provisions SET provisioningid = $1 WHERE id = $2 AND provisioningid = $3 AND servicetype = $4`,
        [newProvisioningId, orderId, provisioningId, serviceType]
    );
};

// Q07 - Bill units and invoices (newest first)
export const q07BillUnitsAndInvoices = (accountId: string) =>
    queryDatabase<Invoice>(
        `
    SELECT billunitid, invoiceunitid, startdate, enddate, billtotal, due, invoicedate, duedate, invoicestatus
    FROM core_engine.bill_invoice_view
    WHERE accountid = $1
    ORDER BY invoicedate DESC NULLS LAST, startdate DESC
  `,
        [accountId]
    );

// Q08 - Bill units, including those without an invoice
export const q08BillUnits = (accountId: string) =>
    queryDatabase<BillUnit>(`SELECT id, status, startdate, enddate, total FROM core_engine.bill_unit WHERE accountid = $1 ORDER BY startdate`, [accountId]);

// Q09 - Job schedules for the given dates with their pending job count.
// Delete a schedule only when pending_jobs = 0 and the previous day has not been processed yet
// (see cleanJobs in helpers/jobs.ts, which enforces the pending check).
export const q09JobSchedules = (dates: string[]) =>
    queryDatabase<JobScheduleCheck>(
        `
    SELECT js.id, js.scheduledate, js.status,
           count(j.id) FILTER (WHERE j.status = 'PENDING')::int AS pending_jobs
    FROM core_engine.job_schedule js
    LEFT JOIN core_engine.job_schedule_list jsl ON jsl.id = js.id
    LEFT JOIN core_engine.jobs j ON j.id = jsl.jobid
    WHERE js.scheduledate = ANY($1::date[])
    GROUP BY 1, 2, 3
    ORDER BY 2
  `,
        [dates]
    );

// Q10 - Job errors and successes for the account
export const q10JobResults = (accountId: string) =>
    queryDatabase<JobResult>(
        `
    SELECT 'error' AS t, type, status, reason, refid FROM core_engine.jobs_error WHERE accountid = $1
    UNION ALL
    SELECT 'success', type, status, reason, refid FROM core_engine.jobs_success WHERE accountid = $1
  `,
        [accountId]
    );

// Q11 - Collection units
export const q11CollectionUnits = (accountId: string) =>
    queryDatabase<CollectionUnit>(
        `SELECT invoiceid, duedate, status, daysincollection, nextaction, nextactiondate FROM core_engine.collection_units WHERE accountid = $1`,
        [accountId]
    );

// Q12 - Queued (PENDING) jobs for the account
export const q12PendingJobs = (accountId: string) =>
    queryDatabase<PendingJob>(
        `
    SELECT j.id, j.type, j.status, jm.name
    FROM core_engine.jobs j
    LEFT JOIN core_engine.job_master jm ON jm.id = j.id
    WHERE j.accountid = $1 AND j.status = 'PENDING'
  `,
        [accountId]
    );

// Q13 - A day's job schedule entries (the queued jobid from Q12 must appear here)
export const q13JobScheduleForDate = (scheduleDate: string) =>
    queryDatabase<JobScheduleEntry>(
        `
    SELECT js.id, js.status, jsl.index, jsl.type, jsl.jobid, jsl.status AS liststatus
    FROM core_engine.job_schedule js
    JOIN core_engine.job_schedule_list jsl ON jsl.id = js.id
    WHERE js.scheduledate = $1
    ORDER BY jsl.index
  `,
        [scheduleDate]
    );

// Q14 - Emails sent
export const q14Emails = (accountId: string) =>
    queryDatabase<EmailNotification>(`SELECT type, status, createddate FROM core_engine.email_notification WHERE accountid = $1 ORDER BY createddate`, [accountId]);

// Q15 - Subscription and services
export const q15SubscriptionAndServices = async (accountId: string) => ({
    subscriptions: await queryDatabase<Subscription>(`SELECT id, status, reason, effectivedate FROM core_engine.subscription WHERE accountid = $1`, [accountId]),
    services: await queryDatabase<ServiceUnit>(`SELECT id, type, status, reason FROM core_engine.service_unit WHERE accountid = $1`, [accountId]),
});

// Q16 - Suspension / reconnection orders (every order that is not NEW), with their provisioning steps
export const q16NonNewOrders = (accountId: string) =>
    queryDatabase<NonNewOrder>(
        `
    SELECT o.id, o.type, o.status, o.createddate,
           string_agg(opsl.apiname || '=' || opsl.status, ' | ' ORDER BY opsl.index) AS steps
    FROM core_oms."order" o
    LEFT JOIN core_oms.order_prov_sequence_list opsl ON opsl.id = o.id
    WHERE o.accountid = $1 AND o.type <> 'NEW'
    GROUP BY 1, 2, 3, 4
    ORDER BY o.createddate
  `,
        [accountId]
    );

// Q17 - Payments
export const q17Payments = (accountId: string) =>
    queryDatabase<Payment>(`SELECT id, amount, remainingamount, status, paymentdate FROM core_engine.payment WHERE accountid = $1 ORDER BY id`, [accountId]);

// Q18 - Contract charges
export const q18PriceUnits = (accountId: string) =>
    queryDatabase<PriceUnit>(
        `
    SELECT id, priceofferid, serviceunitid, servicetype, bundleid, packageid, status, quantity
    FROM core_engine.price_unit
    WHERE accountid = $1
    ORDER BY serviceunitid
  `,
        [accountId]
    );

// Postgres returns dates as Date objects and numerics as strings; these normalise them for asserts.
export const dateOf = (value: Date | string | null | undefined) => {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : String(value);
};

export const numberOf = (value: string | number | null | undefined) => Number(value ?? 0);
