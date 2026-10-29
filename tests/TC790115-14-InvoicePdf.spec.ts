import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { ACCOUNT_ID } from '../test-data/testIds';
import { login, readInvoices, logInvoices, q19InvoiceLines, q20InvoiceTaxLines, q21InvoiceTotals, numberOf } from '../helpers';

// 790115 TC-14 (EFT-63 / EFT-97): the invoice PDF must match Embrix.
//   1. PDF total = Embrix balance (invoice due / account balance).
//   2. PDF 911 and Cruz Roja = Embrix Tax Lines (IVA was never affected).
// The known failure doubled the VOIP line (EFT-97) and the XML/PDF then counted the 911 / Cruz Roja
// base twice (EFT-63, 9 Oct comment); both fixed in release 3.2.5.
//
// The PDF download is manual: open the invoice in the UI and save the PDF (the file Coope's UI
// produces is named INVOICE_<account>_<invoice>_<date>.pdf). The spec finds it by invoice ID in
// test-data/invoices/ (committed, for sharing) or ~/Downloads, or takes PDF_PATH:
//   [INVOICE_ID=418817] [PDF_PATH=/path/to/invoice.pdf] npx playwright test TC790115-14 --headed
// Without a file the spec prints the Embrix side (lines, Tax Lines, totals, balance) and, when
// Embrix stored the PDF itself (invoice_unit.invoicebase64pdf), reads that one instead.
// Each value is logged next to the PDF's, not asserted (run and check).

const PDF_FOLDERS = [path.join(__dirname, '..', 'test-data', 'invoices'), path.join(process.env.HOME ?? '', 'Downloads')];

const findInvoicePdf = (invoiceId: string) => {
    for (const folder of PDF_FOLDERS) {
        if (!fs.existsSync(folder)) continue;
        const file = fs.readdirSync(folder).find(name => name.toLowerCase().endsWith('.pdf') && name.includes(invoiceId));
        if (file) return path.join(folder, file);
    }
    return undefined;
};

const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (data: Buffer) => Promise<{ text: string }>;

// "₡24,320.11", "24.320,11" or "24320.11" -> 24320.11
const moneyFromText = (text: string) => {
    const match = text.replace(/\s/g, '').match(/-?[\d.,]*\d/g);
    if (!match) return NaN;
    const raw = match[match.length - 1];
    const normalised = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    return Number(normalised);
};

// The Coope PDF prints the label on one line and "¢amount" on the next ("911" / "¢58.39"), except
// TOTAL which is on one line ("TOTAL¢24,320.10"). Takes the amount on the label line, else the next line.
const amountOnLine = (lines: string[], label: RegExp) => {
    const index = lines.findIndex(l => label.test(l));
    if (index < 0) return NaN;
    const onLabelLine = moneyFromText(lines[index].replace(label, ''));
    return Number.isNaN(onLabelLine) ? moneyFromText(lines[index + 1] ?? '') : onLabelLine;
};

const compare = (name: string, embrix: number, pdf: number) => {
    const verdict = Number.isNaN(pdf) ? 'NOT FOUND IN PDF' : Math.abs(embrix - pdf) < 0.005 ? 'MATCH' : `DIFFERS by ${(pdf - embrix).toFixed(2)}`;
    console.log(`${name}: Embrix ${embrix.toFixed(2)} | PDF ${Number.isNaN(pdf) ? '-' : pdf.toFixed(2)} | ${verdict}`);
};

test('790115 TC-14 - invoice PDF total and 911 / Cruz Roja match Embrix', async ({ page }) => {
    test.setTimeout(10 * 60 * 1000);

    const accountId = ACCOUNT_ID;

    await login(page);

    // 1. THE INVOICE: INVOICE_ID or the latest STAMPED invoice in the Bills table
    const invoices = await readInvoices(page, accountId);
    logInvoices(invoices);

    const invoice = process.env.INVOICE_ID
        ? invoices.find(row => row.invoiceId === process.env.INVOICE_ID)
        : invoices.find(row => row.folioStatus === 'STAMPED');

    if (!invoice) throw new Error(`No ${process.env.INVOICE_ID ? `invoice ${process.env.INVOICE_ID}` : 'STAMPED invoice'} in the Bills table of ${accountId}`);

    // 2. EMBRIX SIDE: lines, Tax Lines, totals, balance
    const lines = await q19InvoiceLines(invoice.invoiceId);
    const taxLines = await q20InvoiceTaxLines(invoice.invoiceId);
    const totals = await q21InvoiceTotals(invoice.invoiceId);

    const taxAmount = (category: string) => taxLines.filter(t => t.taxcategory === category).reduce((sum, t) => sum + numberOf(t.amount), 0);
    const embrix = {
        total: numberOf(totals.total),
        due: numberOf(totals.due),
        balance: numberOf(totals.balance),
        tax911: taxAmount('911'),
        taxCruzRoja: taxAmount('CR'),
        taxIva: taxAmount('IVA'),
        voipLines: lines.filter(l => l.itemid === 'I_VOIP').length,
    };

    console.log('================================================');
    console.log(`INVOICE ${invoice.invoiceId} | ${invoice.startDate} -> ${invoice.endDate} | Bills table total ${invoice.billTotal} due ${invoice.due}`);
    console.log('Invoice lines:');
    for (const line of lines) console.log(`  ${line.index}. ${line.name} (${line.itemid}) x${numberOf(line.quantity)} = ${numberOf(line.amount).toFixed(2)} [${line.taxcode}]`);
    console.log('Tax Lines:');
    for (const tax of taxLines) console.log(`  ${tax.index}. ${tax.taxcategory} ${(numberOf(tax.taxrate) * 100).toFixed(2)}% on ${numberOf(tax.taxableamount).toFixed(2)} = ${numberOf(tax.amount).toFixed(2)}`);
    console.log(`Subtotal ${numberOf(totals.summarysubtotal).toFixed(2)} + taxes ${numberOf(totals.taxsubtotal).toFixed(2)} = total ${embrix.total.toFixed(2)} | due ${embrix.due.toFixed(2)} | account balance ${embrix.balance.toFixed(2)}`);
    console.log(`911 ${embrix.tax911.toFixed(2)} | Cruz Roja ${embrix.taxCruzRoja.toFixed(2)} | IVA ${embrix.taxIva.toFixed(2)}`);
    console.log(`TELEFONIA VOIP lines: ${embrix.voipLines} | Sheet expects 1: ${embrix.voipLines === 1 ? 'MATCH' : 'DIFFERS (EFT-97)'}`);
    console.log('================================================');

    // 3. PDF SIDE: manual download (PDF_PATH) or the PDF Embrix stored
    let pdfBuffer: Buffer | null = null;
    const pdfPath = process.env.PDF_PATH ?? findInvoicePdf(invoice.invoiceId);

    if (pdfPath) {
        pdfBuffer = fs.readFileSync(pdfPath);
        console.log(`PDF: ${pdfPath}`);
    } else if (totals.pdfbase64) {
        pdfBuffer = Buffer.from(totals.pdfbase64, 'base64');
        console.log('PDF: read from invoice_unit.invoicebase64pdf');
    }

    if (!pdfBuffer) {
        console.log(`No PDF: Embrix did not store one for ${invoice.invoiceId}. Download it from the UI into test-data/invoices/ or ~/Downloads and rerun with INVOICE_ID=${invoice.invoiceId}.`);
        return;
    }

    const { text } = await pdfParse(pdfBuffer);
    const pdfLines = text.split('\n').map(l => l.trim()).filter(Boolean);

    const textFile = path.join('test-results', `TC790115-14-invoice-${invoice.invoiceId}.txt`);
    fs.mkdirSync(path.dirname(textFile), { recursive: true });
    fs.writeFileSync(textFile, text);
    console.log(`PDF text saved to ${textFile} (adjust the labels below if a value is NOT FOUND)`);

    const pdf = {
        total: amountOnLine(pdfLines, /^TOTAL\b/),
        tax911: amountOnLine(pdfLines, /^911$/),
        taxCruzRoja: amountOnLine(pdfLines, /^CRUZ ROJA$/),
        taxIva: amountOnLine(pdfLines, /^IVA$/),
    };

    console.log('================================================');
    console.log('PDF vs EMBRIX');
    compare('Total vs invoice total', embrix.total, pdf.total);
    // The balance is what the customer must pay; only comparable while the invoice is open.
    if (embrix.due > 0) compare('Total vs balance', embrix.balance, pdf.total);
    else console.log(`Total vs balance: invoice already paid (due 0, balance ${embrix.balance.toFixed(2)}); not compared`);
    compare('911', embrix.tax911, pdf.tax911);
    compare('Cruz Roja', embrix.taxCruzRoja, pdf.taxCruzRoja);
    compare('IVA', embrix.taxIva, pdf.taxIva);
    console.log('================================================');
});
