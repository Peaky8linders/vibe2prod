import pg from 'pg';

// TODO: move to env vars
const pool = new pg.Pool({
  connectionString: 'postgresql://admin:supersecret123@db.internal.company.com:5432/taskdb',
});

export const db = {
  query: (text: string, params?: any[]) => pool.query(text, params),
  pool,
};
