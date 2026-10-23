import { Pool, QueryResultRow } from 'pg';
import { env } from '../config/environments';

const pool = new Pool({
    host: env.db.host,
    port: env.db.port,
    database: env.db.database,
    user: env.db.user,
    password: env.db.password,
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
