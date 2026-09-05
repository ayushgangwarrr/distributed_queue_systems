/**
 * src/loadtest/measureProcessing.js
 *
 * Standalone script to measure queue drain time, processing throughput (jobs/sec),
 * and reliability metrics (completion rate, retry count, DLQ count).
 *
 * Runs after load submission finishes. Polls GET /queues/stats every 1s
 * until pending + active + delayed reach 0.
 *
 * CLI Usage:
 *   node src/loadtest/measureProcessing.js [--jobs 5000] [--url http://localhost:3000] [--interval 1000]
 */

const defaultRedis = require('../config/redis');
const jobHistoryRepo = require('../db/jobHistoryRepo');

/**
 * Helper to fetch JSON from an HTTP endpoint using native fetch.
 *
 * @param {string} url
 * @returns {Promise<Object>}
 */
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText} at ${url}`);
  }
  return await res.json();
}

/**
 * Sleep helper.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches reliability metrics from PostgreSQL or fallback to Redis.
 *
 * @param {import('ioredis')} [redis]
 * @returns {Promise<Object>}
 */
async function getReliabilityMetrics(redis = defaultRedis) {
  let completed = 0;
  let dead = 0;
  let retried = 0;
  let totalAudited = 0;

  // 1. Try PostgreSQL first
  try {
    const pool = require('../db/pool');
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'dead')::int AS dead,
        COUNT(*) FILTER (WHERE retry_count > 0)::int AS retried,
        COUNT(*)::int AS total
      FROM job_history;
    `);

    if (result && result.rows && result.rows[0] && Number(result.rows[0].total) > 0) {
      const row = result.rows[0];
      completed = Number(row.completed);
      dead = Number(row.dead);
      retried = Number(row.retried);
      totalAudited = Number(row.total);
      return {
        completed,
        dead,
        retried,
        total: totalAudited,
        source: 'postgres',
      };
    }
  } catch {
    // Postgres offline or empty; fallback to Redis
  }

  // 2. Redis Fallback
  try {
    const jobIds = await redis.zrevrange('jobs:all', 0, 5000);
    if (jobIds && jobIds.length > 0) {
      const pipeline = redis.pipeline();
      for (const id of jobIds) {
        pipeline.hgetall(`job:${id}`);
      }
      const results = await pipeline.exec();

      for (const [err, hash] of results) {
        if (err || !hash || !hash.id) continue;
        totalAudited++;
        if (hash.status === 'completed') completed++;
        if (hash.status === 'dead') dead++;
        const rCount = parseInt(hash.retryCount, 10) || 0;
        if (rCount > 0) retried++;
      }
    }

    const dlqCount = await redis.zcard('queue:dlq');
    if (dlqCount > dead) dead = dlqCount;

    return {
      completed,
      dead,
      retried,
      total: totalAudited,
      source: 'redis',
    };
  } catch (err) {
    console.warn('[measureProcessing] Error reading reliability stats from Redis:', err.message);
    return {
      completed: 0,
      dead: 0,
      retried: 0,
      total: 0,
      source: 'none',
    };
  }
}

/**
 * Measures queue drain time, throughput, and reliability.
 *
 * @param {Object} [options]
 * @param {number} [options.expectedJobs] - Expected job count in batch
 * @param {string} [options.baseUrl='http://localhost:3000']
 * @param {number} [options.pollIntervalMs=1000]
 * @param {number} [options.timeoutMs=300000] - 5 min safety timeout
 * @param {boolean} [options.silent=false]
 * @returns {Promise<Object>}
 */
async function measureProcessing(options = {}) {
  const baseUrl = options.baseUrl || process.env.API_BASE_URL || 'http://localhost:3000';
  const pollIntervalMs = options.pollIntervalMs || 1000;
  const timeoutMs = options.timeoutMs || 300000;
  const silent = options.silent || false;
  let expectedJobs = options.expectedJobs || (process.env.TOTAL_JOBS ? parseInt(process.env.TOTAL_JOBS, 10) : null);

  const statsUrl = `${baseUrl}/queues/stats`;

  if (!silent) {
    console.log('='.repeat(60));
    console.log('  PROCESSING THROUGHPUT & DRAIN MONITOR');
    console.log('='.repeat(60));
    console.log(` Target Endpoint: ${statsUrl}`);
    console.log(` Poll Interval:   ${pollIntervalMs}ms`);
    console.log('-'.repeat(60));
  }

  // Get initial metrics
  const initialReliability = await getReliabilityMetrics();
  const initialCompleted = initialReliability.completed;
  const initialDead = initialReliability.dead;

  const startTime = Date.now();
  let firstNonZeroPollTime = null;
  let lastStats = null;
  let elapsedSec = 0;
  let pollCount = 0;

  while (true) {
    pollCount++;
    try {
      lastStats = await fetchJson(statsUrl);
    } catch (err) {
      if (!silent) console.warn(`[measureProcessing] Poll #${pollCount} failed:`, err.message);
      await sleep(pollIntervalMs);
      continue;
    }

    const inFlight = (lastStats.pending || 0) + (lastStats.active || 0) + (lastStats.delayed || 0);

    if (inFlight > 0 && !firstNonZeroPollTime) {
      firstNonZeroPollTime = Date.now();
    }

    if (!silent) {
      const now = new Date().toLocaleTimeString();
      process.stdout.write(
        `\r [${now}] Poll #${pollCount} | Pending: ${lastStats.pending} | Active: ${lastStats.active} | Delayed: ${lastStats.delayed} | DLQ: ${lastStats.dlq}   `
      );
    }

    // Check if the entire queue has drained
    if (inFlight === 0) {
      // If we observed in-flight jobs, or if we polled at least 2 times and queue is clear
      if (firstNonZeroPollTime || pollCount >= 2) {
        if (!silent) console.log('\n Queue fully drained!');
        break;
      }
    }

    if (Date.now() - startTime > timeoutMs) {
      if (!silent) console.log('\n [TIMEOUT] Queue drain monitor reached max timeout.');
      break;
    }

    await sleep(pollIntervalMs);
  }

  const endTime = Date.now();
  const effectiveStart = firstNonZeroPollTime || startTime;
  const totalDurationMs = Math.max(100, endTime - effectiveStart);
  elapsedSec = Number((totalDurationMs / 1000).toFixed(2));

  // Fetch final reliability stats
  const finalReliability = await getReliabilityMetrics();
  const batchCompleted = Math.max(0, finalReliability.completed - initialCompleted);
  const batchDead = Math.max(0, finalReliability.dead - initialDead);
  const batchTotal = expectedJobs || (batchCompleted + batchDead) || 1;

  const jobsPerSec = Number((batchCompleted / elapsedSec).toFixed(2));
  const firstAttemptCompleted = Math.max(0, batchCompleted - finalReliability.retried);
  const firstAttemptPercent = Number(((firstAttemptCompleted / batchTotal) * 100).toFixed(1));
  const retryPercent = Number(((finalReliability.retried / batchTotal) * 100).toFixed(1));

  const result = {
    totalJobs: batchTotal,
    completed: batchCompleted,
    deadLettered: batchDead,
    retriedAtLeastOnce: finalReliability.retried,
    firstAttemptCompleted,
    firstAttemptPercent,
    retryPercent,
    elapsedSec,
    jobsPerSec,
    startTime: new Date(effectiveStart).toISOString(),
    endTime: new Date(endTime).toISOString(),
    finalQueueStats: lastStats,
    reliabilitySource: finalReliability.source,
  };

  if (!silent) {
    console.log('\n--- Processing Performance Results ---');
    console.log(` Batch Total Jobs:         ${result.totalJobs}`);
    console.log(` Completed Jobs:           ${result.completed}`);
    console.log(` Dead-Lettered:            ${result.deadLettered}`);
    console.log(` Retried >= 1 Time:        ${result.retriedAtLeastOnce}`);
    console.log(` First-Attempt Success:    ${result.firstAttemptPercent}%`);
    console.log(` Wall-Clock Drain Time:    ${result.elapsedSec}s`);
    console.log(` Effective Processing Rate: ${result.jobsPerSec} jobs/sec`);
    console.log('-'.repeat(60));
  }

  return result;
}

// Direct CLI execution
if (require.main === module) {
  measureProcessing()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Processing measurement failed:', err);
      process.exit(1);
    });
}

module.exports = {
  measureProcessing,
  getReliabilityMetrics,
};
