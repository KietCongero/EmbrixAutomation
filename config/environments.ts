import dotenv from 'dotenv';

dotenv.config({ quiet: true });

// ============================================================
// ENVIRONMENT REGISTRY
// ============================================================
// Every URL, DB target and ONT used by the specs lives here.
// Pick one with TEST_ENV (in .env or on the command line):
//
//   TEST_ENV=ns npx playwright test TS01
//
// Credentials stay in .env. Each key is read as <ENV>_<KEY> first, then <KEY>,
// so NS_DB_PASSWORD overrides DB_PASSWORD only when TEST_ENV=ns.

type Environment = {
    uiUrl: string;
    apiUrl: string;
    graphiqlUrl: string;
    db: { host: string; port: number; database: string };
    provisioningId: string;
    ontModel: string;
};

const ENVIRONMENTS = {
    // Embrix demo stack - the combination the regression suites currently run against.
    demo: {
        uiUrl: 'https://core-ui.demo.embrix.org',
        apiUrl: 'https://crm-gateway.coopegsbx.embrix.org',
        graphiqlUrl: 'https://transactional.coopeg.embrix.org/graphiql?',
        db: { host: 'coopegsbx2-dev-db.chg5bgdk4yyp.us-east-1.rds.amazonaws.com', port: 5432, database: 'coredb' },
        provisioningId: 'ALCLB3A97FBA',
        ontModel: 'G-240W-G',
    },
    // NetSuite ("ns") stack.
    ns: {
        uiUrl: 'https://core-ui.coopegsbx2.embrix.org',
        apiUrl: 'https://crm-gateway.coopegsbx2.embrix.org',
        graphiqlUrl: 'https://service-transactional.coopegsbx2.embrix.org/graphiql?',
        db: { host: 'coopegsbx-dev-db.chg5bgdk4yyp.us-east-1.rds.amazonaws.com', port: 5432, database: 'coredb' },
        provisioningId: 'ALCLB3A97FBA',
        ontModel: 'G-240W-G',
    },
} satisfies Record<string, Environment>;

export type EnvironmentName = keyof typeof ENVIRONMENTS;

const name = (process.env.TEST_ENV ?? 'demo') as EnvironmentName;

if (!(name in ENVIRONMENTS)) {
    throw new Error(`Unknown TEST_ENV "${name}". Expected one of: ${Object.keys(ENVIRONMENTS).join(', ')}`);
}

const selected: Environment = ENVIRONMENTS[name];

const secret = (key: string) => process.env[`${name.toUpperCase()}_${key}`] ?? process.env[key];

export const env = {
    name,
    ...selected,
    api: {
        processAccountAndOrder: `${selected.apiUrl}/processAccountAndOrder`,
        applyPayment: `${selected.apiUrl}/applyPayment`,
    },
    username: secret('EMBRIX_USERNAME'),
    password: secret('EMBRIX_PASSWORD'),
    apiToken: secret('EMBRIX_API_TOKEN'),
    ociUsername: secret('OCI_USERNAME'),
    ociPassword: secret('OCI_PASSWORD'),
    db: {
        ...selected.db,
        user: secret('DB_USER'),
        password: secret('DB_PASSWORD'),
    },
};
