/**
 * src/queue/priorityQueue.js
 *
 * Standalone Redis-based Priority Queue engine.
 * Supports:
 * - Deterministic priority + FIFO ordering using Redis Sorted Sets
 * - Atomic dequeue with lease tracking via Lua
 * - Atomic failure handling with exponential backoff, jitter, and DLQ routing
 * - Delayed job promotion scheduler helper
 * - Queue inspection and stats
 */

const crypto = require('crypto');
const defaultRedis = require('../config/redis');
const { registerLuaScripts } = require('./luaScripts');
const eventBus = require('../events/eventBus');
const jobHistoryRepo = require('../db/jobHistoryRepo');

class PriorityQueue {
  /**
   * @param {import('ioredis')} [redisClient] - Optional custom ioredis instance
   */
  constructor(redisClient = defaultRedis) {
    this.redis = redisClient;
    this.PENDING_KEY = 'queue:pending';
    this.ACTIVE_KEY = 'queue:active';
    this.DELAYED_KEY = 'queue:delayed';
    this.DLQ_KEY = 'queue:dlq';

    // Register atomic Lua scripts on the client instance
    registerLuaScripts(this.redis);
  }

  /**
   * Helper to compute sorted set score.
   * Lower score = higher priority + earlier timestamp.
   * Priority range: 1 (lowest) to 10 (highest).
   *
   * @param {number} priority
   * @param {number} timestamp
   * @returns {number}
   */
  _computeScore(priority, timestamp) {
    const clampedPriority = Math.max(1, Math.min(10, Math.floor(priority)));
    return (10 - clampedPriority) * 1e13 + timestamp;
  }

  /**
   * Enqueue a new job.
   *
   * @param {Object} job
   * @param {string} [job.type='default']
   * @param {*} job.data
   * @param {number} [job.priority=5] Priority from 1 (lowest) to 10 (highest)
   * @param {number} [job.maxRetries=3]
   * @returns {Promise<string>} Generated jobId
   */
  async enqueue(job = {}) {
    const id = crypto.randomUUID();
    const type = job.type || 'default';
    const priority = typeof job.priority === 'number' ? Math.max(1, Math.min(10, Math.floor(job.priority))) : 5;
    const maxRetries = typeof job.maxRetries === 'number' ? Math.max(0, Math.floor(job.maxRetries)) : 3;
    const now = Date.now();
    const score = this._computeScore(priority, now);

    const jobKey = `job:${id}`;
    const jobData = {
      id,
      type,
      data: JSON.stringify(job.data !== undefined ? job.data : null),
      priority: priority.toString(),
      status: 'pending',
      retryCount: '0',
      maxRetries: maxRetries.toString(),
      createdAt: now.toString(),
    };

    const pipeline = this.redis.pipeline();
    pipeline.hset(jobKey, jobData);
    pipeline.zadd(this.PENDING_KEY, score, id);
    pipeline.zadd('jobs:all', now, id);
    await pipeline.exec();

    // Publish event and record durable history (non-blocking)
    eventBus.publish('job:created', {
      id,
      type,
      data: job.data,
      priority,
      status: 'pending',
      createdAt: now,
    });
    jobHistoryRepo.insertJob({
      id,
      type,
      data: job.data,
      priority,
      status: 'pending',
      retryCount: 0,
      maxRetries,
      createdAt: now,
    });

    return id;
  }

  /**
   * Atomically dequeue the highest priority (lowest score) job.
   * Uses atomic Lua script to pop from pending, set active lease, and return job data.
   *
   * @param {string} workerId
   * @param {number} [leaseMs=30000]
   * @returns {Promise<Object|null>} Parsed job object or null if queue is empty
   */
  async dequeue(workerId, leaseMs = 30000) {
    if (!workerId) {
      throw new Error('workerId is required to dequeue a job');
    }

    const now = Date.now();
    const rawResult = await this.redis.atomicDequeue(
      this.PENDING_KEY,
      this.ACTIVE_KEY,
      workerId,
      leaseMs,
      now
    );

    if (!rawResult || (Array.isArray(rawResult) && rawResult.length === 0)) {
      return null;
    }

    return this._parseJobHash(rawResult);
  }

  /**
   * Mark an active job as completed.
   *
   * @param {string} jobId
   * @returns {Promise<boolean>}
   */
  async complete(jobId) {
    const now = Date.now();
    const jobKey = `job:${jobId}`;

    const pipeline = this.redis.pipeline();
    pipeline.hset(jobKey, 'status', 'completed', 'completedAt', now.toString());
    pipeline.hdel(this.ACTIVE_KEY, jobId);
    await pipeline.exec();

    return true;
  }

  /**
   * Atomically renew the lease for an active job if the worker is the current owner.
   *
   * @param {string} jobId
   * @param {string} workerId
   * @param {number} [leaseMs=30000]
   * @returns {Promise<boolean>} True if renewed, false if lost or not owned
   */
  async renewLease(jobId, workerId, leaseMs = 30000) {
    if (!jobId || !workerId) return false;
    const now = Date.now();
    const jobKey = `job:${jobId}`;

    const result = await this.redis.atomicRenewLease(
      this.ACTIVE_KEY,
      jobKey,
      jobId,
      workerId,
      leaseMs,
      now
    );

    return result === 1;
  }

  /**
   * Scan 'queue:active' hash for any jobs whose lease has expired (leaseExpiresAt < now).
   * For each expired job, invokes fail() so it re-enters the retry/backoff/DLQ lifecycle.
   *
   * @returns {Promise<Array<{ jobId: string, workerId: string, leaseExpiresAt: number, expiredBy: number }>>}
   */
  async reclaimExpiredLeases() {
    const now = Date.now();
    const rawActive = await this.redis.hgetall(this.ACTIVE_KEY);
    if (!rawActive || Object.keys(rawActive).length === 0) {
      return [];
    }

    const reclaimed = [];
    for (const [jobId, rawVal] of Object.entries(rawActive)) {
      let leaseExpiresAt = null;
      let workerId = 'unknown';

      try {
        const parsed = JSON.parse(rawVal);
        if (typeof parsed === 'object' && parsed !== null) {
          leaseExpiresAt = Number(parsed.leaseExpiresAt);
          workerId = parsed.workerId || 'unknown';
        } else {
          leaseExpiresAt = Number(parsed);
        }
      } catch {
        leaseExpiresAt = Number(rawVal);
      }

      if (leaseExpiresAt && leaseExpiresAt < now) {
        const expiredBy = now - leaseExpiresAt;
        // Fail the job so it goes through retry/backoff or DLQ
        await this.fail(
          jobId,
          `Lease expired: worker '${workerId}' failed to renew in time (expired by ${expiredBy}ms)`
        );
        // Ensure removed from active tracking hash
        await this.redis.hdel(this.ACTIVE_KEY, jobId);

        reclaimed.push({
          jobId,
          workerId,
          leaseExpiresAt,
          expiredBy,
        });
      }
    }

    return reclaimed;
  }

  /**
   * Fail an active job using atomic Lua script.
   * Automatically calculates exponential backoff with jitter and moves job to
   * 'queue:delayed', or routes to 'queue:dlq' if maxRetries is reached.
   *
   * @param {string} jobId
   * @param {string} errorMessage
   * @returns {Promise<Object|null>} Failure result details { action: 'retry'|'dead', retryCount, ... }
   */
  async fail(jobId, errorMessage) {
    const now = Date.now();
    const jitter = Math.floor(Math.random() * 500); // 0-500ms random jitter
    const errorMsgString = typeof errorMessage === 'string'
      ? errorMessage
      : (errorMessage && errorMessage.message ? errorMessage.message : 'Job failed');

    const errorPayload = JSON.stringify({
      message: errorMsgString,
      error: errorMsgString,
      timestamp: now,
    });
    const jobKey = `job:${jobId}`;

    const rawResult = await this.redis.atomicFail(
      jobKey,
      this.ACTIVE_KEY,
      this.DELAYED_KEY,
      this.DLQ_KEY,
      jobId,
      errorPayload,
      now,
      jitter
    );

    if (!rawResult) {
      return null;
    }

    return JSON.parse(rawResult);
  }

  /**
   * Promote delayed jobs whose backoff timer has expired back into queue:pending.
   *
   * @returns {Promise<number>} Number of promoted jobs
   */
  async promoteDelayedJobs() {
    const now = Date.now();
    // Fetch all job IDs with score <= now
    const jobIds = await this.redis.zrangebyscore(this.DELAYED_KEY, '-inf', now);

    if (!jobIds || jobIds.length === 0) {
      return 0;
    }

    let promotedCount = 0;
    for (const jobId of jobIds) {
      const jobKey = `job:${jobId}`;
      const rawPriority = await this.redis.hget(jobKey, 'priority');
      const priority = rawPriority ? parseInt(rawPriority, 10) : 5;
      const score = this._computeScore(priority, Date.now());

      const pipeline = this.redis.pipeline();
      pipeline.zadd(this.PENDING_KEY, score, jobId);
      pipeline.zrem(this.DELAYED_KEY, jobId);
      pipeline.hset(jobKey, 'status', 'pending');
      await pipeline.exec();

      promotedCount += 1;
    }

    return promotedCount;
  }

  /**
   * Retrieve and parse the full job object from Redis.
   *
   * @param {string} jobId
   * @returns {Promise<Object|null>}
   */
  async getJob(jobId) {
    const jobKey = `job:${jobId}`;
    const raw = await this.redis.hgetall(jobKey);
    if (!raw || Object.keys(raw).length === 0) {
      return null;
    }
    return this._parseJobHash(raw);
  }

  /**
   * Retrieve aggregate statistics of all queue partitions.
   *
   * @returns {Promise<{ pending: number, active: number, delayed: number, dlq: number }>}
   */
  async getStats() {
    const pipeline = this.redis.pipeline();
    pipeline.zcard(this.PENDING_KEY);
    pipeline.hlen(this.ACTIVE_KEY);
    pipeline.zcard(this.DELAYED_KEY);
    pipeline.zcard(this.DLQ_KEY);

    const results = await pipeline.exec();

    return {
      pending: results[0] && results[0][1] ? Number(results[0][1]) : 0,
      active: results[1] && results[1][1] ? Number(results[1][1]) : 0,
      delayed: results[2] && results[2][1] ? Number(results[2][1]) : 0,
      dlq: results[3] && results[3][1] ? Number(results[3][1]) : 0,
    };
  }

  /**
   * Internal helper to parse raw Redis hash data (array or object) into typed JS fields.
   *
   * @param {Array<string>|Object} raw
   * @returns {Object|null}
   */
  _parseJobHash(raw) {
    if (!raw) return null;
    let obj = {};

    if (Array.isArray(raw)) {
      if (raw.length === 0) return null;
      for (let i = 0; i < raw.length; i += 2) {
        obj[raw[i]] = raw[i + 1];
      }
    } else {
      if (Object.keys(raw).length === 0) return null;
      obj = { ...raw };
    }

    if (obj.data) {
      try {
        obj.data = JSON.parse(obj.data);
      } catch {
        // Keep as raw string if JSON parsing fails
      }
    }

    if (obj.errors) {
      try {
        const parsed = JSON.parse(obj.errors);
        obj.errors = Array.isArray(parsed)
          ? parsed.map((err) => {
              if (typeof err === 'string') {
                try {
                  const item = JSON.parse(err);
                  if (typeof item === 'object' && item !== null) return item;
                } catch {
                  return { message: err, error: err, timestamp: null };
                }
              }
              return err;
            })
          : [parsed];
      } catch {
        obj.errors = [{ message: obj.errors, error: obj.errors, timestamp: null }];
      }
    } else {
      obj.errors = [];
    }

    if (obj.failedAt) {
      obj.diedAt = Number(obj.failedAt);
    }

    if (obj.priority !== undefined) obj.priority = Number(obj.priority);
    if (obj.retryCount !== undefined) obj.retryCount = Number(obj.retryCount);
    if (obj.maxRetries !== undefined) obj.maxRetries = Number(obj.maxRetries);
    if (obj.createdAt !== undefined) obj.createdAt = Number(obj.createdAt);
    if (obj.leaseExpiresAt !== undefined) obj.leaseExpiresAt = Number(obj.leaseExpiresAt);
    if (obj.dequeuedAt !== undefined) obj.dequeuedAt = Number(obj.dequeuedAt);
    if (obj.completedAt !== undefined) obj.completedAt = Number(obj.completedAt);
    if (obj.failedAt !== undefined) obj.failedAt = Number(obj.failedAt);
    if (obj.delayedUntil !== undefined) obj.delayedUntil = Number(obj.delayedUntil);

    return obj;
  }
}

module.exports = PriorityQueue;
