const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:                    process.env.DB_HOST || 'localhost',
  port:                    parseInt(process.env.DB_PORT) || 5432,
  database:                process.env.DB_NAME,
  user:                    process.env.DB_USER,
  password:                process.env.DB_PASSWORD,
  ssl:                     process.env.NODE_ENV === 'production'
                             ? { rejectUnauthorized: false }
                             : false,
  max:                     20,
  idleTimeoutMillis:       30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  console.log('PostgreSQL connected');
});

pool.on('error', (err) => {
  console.error('PostgreSQL error:', err);
  process.exit(-1);
});

module.exports = { pool };