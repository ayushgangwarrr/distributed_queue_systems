/**
 * src/api/routes.js
 *
 * REST API routes for job management, queue statistics, and system health.
 */

const express = require('express');
const defaultRedis = require('../config/redis');
const PriorityQueue = require('../queue/priorityQueue');
const { validateJobSubmission } = require('./validation');
const jobHistoryRepo = require('../db/jobHistoryRepo');

const router = express.Router();
const redis = defaultRedis;
const priorityQueue = new PriorityQueue(redis);

/**
 * Async wrapper utility to catch errors and forward them to the error handler.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ---------------------------------------------------------------------------
// POST /jobs - Submit a new job to the queue
// ---------------------------------------------------------------------------
router.post(
  '/jobs',
  validateJobSubmission,
  asyncHandler(async (req, res) => {
    const id = await priorityQueue.enqueue(req.body);
    res.status(201).json({
      id,
      status: 'pending',
    });
  })
);

// ---------------------------------------------------------------------------
// GET /jobs/:id - Get a specific job by ID
// ---------------------------------------------------------------------------
router.get(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const job = await priorityQueue.getJob(id);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        message: `No job found with ID: ${id}`,
      });
    }

    res.json(job);
  })
);

// ---------------------------------------------------------------------------
// GET /jobs - List jobs with pagination and optional status filter
// ---------------------------------------------------------------------------
router.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 20);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const statusFilter = req.query.status ? req.query.status.trim().toLowerCase() : null;

    const totalAll = await redis.zcard('jobs:all');

    if (!statusFilter) {
      // Direct pagination from sorted set
      const jobIds = await redis.zrevrange('jobs:all', offset, offset + limit - 1);
      const jobs = [];
      for (const id of jobIds) {
        const job = await priorityQueue.getJob(id);
        if (job) {
          jobs.push(job);
        }
      }

      return res.json({
        jobs,
        total: totalAll,
        limit,
        offset,
      });
    }

    // Filtered by status: fetch IDs, retrieve jobs, filter in memory
    const allIds = await redis.zrevrange('jobs:all', 0, -1);
    const filteredJobs = [];
    for (const id of allIds) {
      const job = await priorityQueue.getJob(id);
      if (job && job.status && job.status.toLowerCase() === statusFilter) {
        filteredJobs.push(job);
      }
    }

    const paginatedJobs = filteredJobs.slice(offset, offset + limit);

    res.json({
      jobs: paginatedJobs,
      total: filteredJobs.length,
      limit,
      offset,
    });
  })
);

// ---------------------------------------------------------------------------
// DELETE /jobs/:id - Cancel a pending job
// ---------------------------------------------------------------------------
router.delete(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const job = await priorityQueue.getJob(id);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        message: `No job found with ID: ${id}`,
      });
    }

    if (job.status !== 'pending') {
      return res.status(409).json({
        error: 'Conflict',
        message: `Cannot cancel job with status '${job.status}'. Only 'pending' jobs can be cancelled.`,
      });
    }

    const pipeline = redis.pipeline();
    pipeline.zrem(priorityQueue.PENDING_KEY, id);
    pipeline.zrem('jobs:all', id);
    pipeline.del(`job:${id}`);
    await pipeline.exec();

    res.status(200).json({
      message: `Job ${id} cancelled successfully`,
    });
  })
);

// ---------------------------------------------------------------------------
// POST /jobs/:id/retry - Retry a dead job from DLQ
// ---------------------------------------------------------------------------
router.post(
  '/jobs/:id/retry',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const job = await priorityQueue.getJob(id);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        message: `No job found with ID: ${id}`,
      });
    }

    if (job.status !== 'dead') {
      return res.status(409).json({
        error: 'Conflict',
        message: `Only dead jobs in DLQ can be retried. Current status is '${job.status}'.`,
      });
    }

    const now = Date.now();
    const priority = job.priority || 5;
    const clampedPriority = Math.max(1, Math.min(10, Math.floor(priority)));
    const freshScore = (10 - clampedPriority) * 1e13 + now;

    const pipeline = redis.pipeline();
    pipeline.hset(
      `job:${id}`,
      'status', 'pending',
      'retryCount', '0',
      'retriedAt', now.toString()
    );
    pipeline.zrem(priorityQueue.DLQ_KEY, id);
    pipeline.zadd(priorityQueue.PENDING_KEY, freshScore, id);
    await pipeline.exec();

    const updatedJob = await priorityQueue.getJob(id);

    res.status(200).json({
      message: `Job ${id} successfully re-queued`,
      job: updatedJob,
    });
  })
);

// ---------------------------------------------------------------------------
// GET /queues/stats - Retrieve queue partition statistics
// ---------------------------------------------------------------------------
router.get(
  '/queues/stats',
  asyncHandler(async (req, res) => {
    const stats = await priorityQueue.getStats();
    res.json(stats);
  })
);

// ---------------------------------------------------------------------------
// GET /stats/throughput - Retrieve throughput from Postgres audit history
// ---------------------------------------------------------------------------
router.get(
  '/stats/throughput',
  asyncHandler(async (req, res) => {
    const windowMinutes = Math.max(1, parseInt(req.query.windowMinutes, 10) || 60);
    const data = await jobHistoryRepo.getThroughputStats(windowMinutes);
    res.json({
      windowMinutes,
      data,
    });
  })
);

// ---------------------------------------------------------------------------
// GET /health - Check Redis connection and system health
// ---------------------------------------------------------------------------
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    try {
      const pingReply = await redis.ping();
      if (pingReply === 'PONG') {
        return res.status(200).json({
          status: 'ok',
          redis: 'connected',
        });
      }
      return res.status(503).json({
        status: 'unhealthy',
        redis: 'disconnected',
      });
    } catch (err) {
      return res.status(503).json({
        status: 'unhealthy',
        redis: 'disconnected',
        error: err.message,
      });
    }
  })
);

// ---------------------------------------------------------------------------
// GET /dlq - List all dead-lettered jobs with pagination (most recent first)
// ---------------------------------------------------------------------------
router.get(
  '/dlq',
  asyncHandler(async (req, res) => {
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 20);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const total = await redis.zcard(priorityQueue.DLQ_KEY);
    const jobIds = await redis.zrevrange(priorityQueue.DLQ_KEY, offset, offset + limit - 1);

    const jobs = [];
    for (const id of jobIds) {
      const job = await priorityQueue.getJob(id);
      if (job) {
        jobs.push({
          id: job.id,
          type: job.type,
          retryCount: job.retryCount,
          maxRetries: job.maxRetries,
          errors: job.errors || [],
          createdAt: job.createdAt,
          diedAt: job.diedAt || job.failedAt || null,
          status: job.status,
        });
      }
    }

    res.json({
      jobs,
      total,
      limit,
      offset,
    });
  })
);

// ---------------------------------------------------------------------------
// POST /dlq/:id/retry - Retry a job from the Dead Letter Queue
// ---------------------------------------------------------------------------
router.post(
  '/dlq/:id/retry',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const job = await priorityQueue.getJob(id);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        message: `No job found with ID: ${id}`,
      });
    }

    if (job.status !== 'dead') {
      return res.status(409).json({
        error: 'Conflict',
        message: `Only dead jobs in DLQ can be retried. Current status is '${job.status}'.`,
      });
    }

    const now = Date.now();
    const priority = job.priority || 5;
    const clampedPriority = Math.max(1, Math.min(10, Math.floor(priority)));
    const freshScore = (10 - clampedPriority) * 1e13 + now;

    const pipeline = redis.pipeline();
    pipeline.hset(
      `job:${id}`,
      'status', 'pending',
      'retryCount', '0',
      'retriedAt', now.toString(),
      'retriedFrom', 'dlq'
    );
    pipeline.zrem(priorityQueue.DLQ_KEY, id);
    pipeline.zadd(priorityQueue.PENDING_KEY, freshScore, id);
    await pipeline.exec();

    const updatedJob = await priorityQueue.getJob(id);

    res.status(200).json({
      message: `Job ${id} successfully re-queued from DLQ`,
      source: 'dlq',
      job: updatedJob,
    });
  })
);

// ---------------------------------------------------------------------------
// DELETE /dlq/:id - Permanently purge a job from the DLQ
// ---------------------------------------------------------------------------
router.delete(
  '/dlq/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const score = await redis.zscore(priorityQueue.DLQ_KEY, id);

    if (score === null) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Job ${id} not found in DLQ`,
      });
    }

    const pipeline = redis.pipeline();
    pipeline.zrem(priorityQueue.DLQ_KEY, id);
    pipeline.zrem('jobs:all', id);
    pipeline.del(`job:${id}`);
    await pipeline.exec();

    res.status(200).json({
      message: `Job ${id} permanently purged from DLQ`,
      id,
    });
  })
);

module.exports = router;
