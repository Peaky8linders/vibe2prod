import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new pg.Pool({ connectionString });

export const db = {
  query: (text: string, params?: unknown[]) => pool.query(text, params),
  pool,
};
