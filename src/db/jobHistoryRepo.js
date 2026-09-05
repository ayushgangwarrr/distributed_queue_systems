/**
 * src/db/jobHistoryRepo.js
 *
 * PostgreSQL repository for durable job history and audit logging.
 * Non-blocking: all errors are logged as warnings and do not disrupt queue operations.
 */

const pool = require('./pool');

/**
 * Record a new job in PostgreSQL when first enqueued.
 *
 * @param {Object} job
 * @returns {Promise<Object|null>}
 */
async function insertJob(job) {
  try {
    const id = job.id;
    const type = job.type || 'default';
    const payload = typeof job.data === 'string' ? job.data : JSON.stringify(job.data || job.payload || {});
    const priority = Number(job.priority || 5);
    const status = job.status || 'pending';
    const retryCount = Number(job.retryCount || 0);
    const maxRetries = Number(job.maxRetries || 3);
    const createdAt = job.createdAt ? new Date(Number(job.createdAt)) : new Date();

    const query = `
      INSERT INTO job_history (id, type, payload, priority, status, retry_count, max_retries, created_at)
      VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        type = EXCLUDED.type,
        priority = EXCLUDED.priority,
        payload = EXCLUDED.payload;
    `;

    const result = await pool.query(query, [
      id,
      type,
      payload,
      priority,
      status,
      retryCount,
      maxRetries,
      createdAt,
    ]);

    return result;
  } catch (err) {
    console.warn('[Postgres jobHistoryRepo.insertJob Warning]:', err.message);
    return null;
  }
}

/**
 * Update job status and audit details on state transition.
 *
 * @param {string} id
 * @param {string} status
 * @param {Object} [extra]
 * @returns {Promise<Object|null>}
 */
async function updateJobStatus(id, status, extra = {}) {
  try {
    const sets = ['status = $2'];
    const values = [id, status];
    let idx = 3;

    const workerId = extra.worker_id || extra.workerId;
    if (workerId) {
      sets.push(`worker_id = $${idx++}`);
      values.push(workerId);
    }

    const startedAt = extra.started_at || extra.startedAt;
    if (startedAt) {
      sets.push(`started_at = $${idx++}`);
      values.push(startedAt instanceof Date ? startedAt : new Date(startedAt));
    }

    const completedAt = extra.completed_at || extra.completedAt;
    if (completedAt) {
      sets.push(`completed_at = $${idx++}`);
      values.push(completedAt instanceof Date ? completedAt : new Date(completedAt));
    }

    const retryCount = extra.retry_count ?? extra.retryCount;
    if (retryCount !== undefined) {
      sets.push(`retry_count = $${idx++}`);
      values.push(Number(retryCount));
    }

    const errMsg = extra.error || extra.errorMessage;
    if (errMsg) {
      const errEntry = JSON.stringify([
        {
          message: typeof errMsg === 'string' ? errMsg : (errMsg.message || 'Job error'),
          timestamp: Date.now(),
        },
      ]);
      sets.push(`error_log = COALESCE(error_log, '[]'::jsonb) || $${idx++}::jsonb`);
      values.push(errEntry);
    }

    const query = `
      UPDATE job_history
      SET ${sets.join(', ')}
      WHERE id = $1;
    `;

    return await pool.query(query, values);
  } catch (err) {
    console.warn('[Postgres jobHistoryRepo.updateJobStatus Warning]:', err.message);
    return null;
  }
}

/**
 * Fetch paginated recent jobs from PostgreSQL audit history.
 *
 * @param {number} [limit=50]
 * @param {number} [offset=0]
 * @param {string|null} [statusFilter=null]
 * @returns {Promise<Array<Object>>}
 */
async function getRecentJobs(limit = 50, offset = 0, statusFilter = null) {
  try {
    const query = `
      SELECT *
      FROM job_history
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
    `;

    const result = await pool.query(query, [statusFilter, limit, offset]);
    return result.rows;
  } catch (err) {
    console.warn('[Postgres jobHistoryRepo.getRecentJobs Warning]:', err.message);
    return [];
  }
}

/**
 * Aggregates throughput: jobs completed per minute over the given window.
 *
 * @param {number} [windowMinutes=60]
 * @returns {Promise<Array<{ minute: string, count: number }>>}
 */
async function getThroughputStats(windowMinutes = 60) {
  try {
    const query = `
      SELECT
        to_char(date_trunc('minute', completed_at), 'YYYY-MM-DD"T"HH24:MI:00"Z"') AS minute,
        COUNT(*)::int AS count
      FROM job_history
      WHERE status = 'completed'
        AND completed_at >= NOW() - ($1 || ' minutes')::interval
      GROUP BY date_trunc('minute', completed_at)
      ORDER BY minute ASC;
    `;

    const result = await pool.query(query, [windowMinutes]);
    return result.rows;
  } catch (err) {
    console.warn('[Postgres jobHistoryRepo.getThroughputStats Warning]:', err.message);
    return [];
  }
}

/**
 * Computes average wait time grouped by priority for completed jobs.
 * Attempts PostgreSQL first: AVG(started_at - created_at) grouped by priority.
 * If PostgreSQL is unavailable or returns 0 rows, falls back to Redis:
 * reads jobs from 'jobs:all' and computes (dequeuedAt - createdAt) for completed jobs.
 *
 * @returns {Promise<Array<{ priority: number, avgWaitMs: number, count: number }>>}
 */
async function getAverageWaitTimeByPriority() {
  // 1. Try PostgreSQL
  try {
    const query = `
      SELECT
        priority,
        AVG(EXTRACT(EPOCH FROM (started_at - created_at)) * 1000)::float AS "avgWaitMs",
        COUNT(*)::int AS count
      FROM job_history
      WHERE status = 'completed' AND started_at IS NOT NULL AND created_at IS NOT NULL
      GROUP BY priority
      ORDER BY priority DESC;
    `;
    const result = await pool.query(query);
    if (result && result.rows && result.rows.length > 0) {
      return result.rows.map(row => ({
        priority: Number(row.priority),
        avgWaitMs: Math.round(Number(row.avgWaitMs)),
        count: Number(row.count),
      }));
    }
  } catch (err) {
    console.warn('[Postgres jobHistoryRepo.getAverageWaitTimeByPriority Warning]:', err.message);
  }

  // 2. Fallback to Redis
  try {
    const defaultRedis = require('../config/redis');
    const jobIds = await defaultRedis.zrevrange('jobs:all', 0, 5000);
    if (!jobIds || jobIds.length === 0) return [];

    const pipeline = defaultRedis.pipeline();
    for (const id of jobIds) {
      pipeline.hgetall(`job:${id}`);
    }
    const results = await pipeline.exec();

    const priorityBuckets = {}; // priority -> { totalWaitMs, count }

    for (const [err, jobHash] of results) {
      if (err || !jobHash || !jobHash.priority) continue;
      const createdAt = Number(jobHash.createdAt);
      const dequeuedAt = Number(jobHash.dequeuedAt || jobHash.startedAt || jobHash.completedAt);
      if (!createdAt || !dequeuedAt || dequeuedAt < createdAt) continue;

      const priority = Number(jobHash.priority);
      const waitMs = dequeuedAt - createdAt;

      if (!priorityBuckets[priority]) {
        priorityBuckets[priority] = { totalWaitMs: 0, count: 0 };
      }
      priorityBuckets[priority].totalWaitMs += waitMs;
      priorityBuckets[priority].count += 1;
    }

    const output = Object.entries(priorityBuckets).map(([p, data]) => ({
      priority: Number(p),
      avgWaitMs: Math.round(data.totalWaitMs / data.count),
      count: data.count,
    })).sort((a, b) => b.priority - a.priority);

    return output;
  } catch (err) {
    console.warn('[Redis fallback getAverageWaitTimeByPriority Error]:', err.message);
    return [];
  }
}

module.exports = {
  insertJob,
  updateJobStatus,
  getRecentJobs,
  getThroughputStats,
  getAverageWaitTimeByPriority,
};

