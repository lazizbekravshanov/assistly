import fs from 'node:fs';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = fs.readFileSync('migrations/001_init_postgres.sql', 'utf8');
const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(sql);
  console.log('postgres migration applied: 001_init_postgres.sql');
} finally {
  await pool.end();
}

