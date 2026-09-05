/**
 * src/db/pool.js
 *
 * Configured PostgreSQL connection pool using pg.
 * Gracefully handles errors and connection drops without crashing Node.
 */

const { Pool } = require('pg');
require('dotenv').config();

const connectionString =
  process.env.POSTGRES_URL || 'postgres://postgres:postgres@localhost:5432/queue_db';

const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 2000,
  idleTimeoutMillis: 10000,
  max: 10,
});

// Suppress unhandled pool error events so connection refusal doesn't terminate process
pool.on('error', (err) => {
  console.warn('[Postgres Pool Warning]:', err.message);
});

module.exports = pool;
