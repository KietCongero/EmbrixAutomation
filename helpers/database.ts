import { Pool, QueryResultRow } from 'pg';

const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: {
        rejectUnauthorized: false,
    },
    connectionTimeoutMillis: 10000,
});

export async function queryDatabase<T extends QueryResultRow>(
    sql: string,
    values: unknown[] = []
): Promise<T[]> {
    const result = await pool.query<T>(sql, values);
    return result.rows;
}