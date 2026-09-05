/**
 * src/workers/handlerRegistry.js
 *
 * Map-based registry for job type handlers.
 * Allows decoupled registration and dispatching of task handlers.
 */

const handlers = new Map();

/**
 * Register a handler function for a specific job type.
 *
 * @param {string} type - The job type identifier
 * @param {Function} fn - Async handler function (jobData, job) => Promise<any>
 */
function registerHandler(type, fn) {
  if (typeof type !== 'string' || !type.trim()) {
    throw new Error('Handler type must be a non-empty string');
  }
  if (typeof fn !== 'function') {
    throw new Error(`Handler for type "${type}" must be a function`);
  }
  handlers.set(type, fn);
}

/**
 * Retrieve a registered handler for a specific job type.
 *
 * @param {string} type - The job type identifier
 * @returns {Function|undefined}
 */
function getHandler(type) {
  return handlers.get(type);
}

// Helper to delay execution
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Register the hardcoded 'demo-task' handler
registerHandler('demo-task', async (jobData, job) => {
  const jobId = (job && job.id) || (jobData && jobData.id) || 'unknown';
  console.log(`[Handler:demo-task] Processing job ${jobId}...`);

  // Simulate 2 seconds of asynchronous work
  await sleep(2000);

  if (jobData && jobData.shouldFail === true) {
    throw new Error(`Simulated demo failure: shouldFail is true for job ${jobId}`);
  }

  return {
    success: true,
    processedAt: new Date().toISOString(),
    message: `Job ${jobId} finished processing successfully`,
    data: jobData,
  };
});

// Register 'flaky-task' handler
registerHandler('flaky-task', async (jobData, job) => {
  const jobId = (job && job.id) || (jobData && jobData.id) || 'unknown';
  const retryCount = Number(job?.retryCount ?? jobData?.retryCount ?? 0);
  const failUntilAttempt = Number(jobData?.failUntilAttempt ?? 1);

  console.log(
    `[Handler:flaky-task] Processing job ${jobId} (retryCount: ${retryCount}, failUntilAttempt: ${failUntilAttempt})...`
  );

  if (retryCount < failUntilAttempt) {
    throw new Error(
      `Flaky task simulated failure on attempt ${retryCount + 1} (fails until attempt ${failUntilAttempt})`
    );
  }

  return {
    success: true,
    processedAt: new Date().toISOString(),
    retryCount,
    message: `Flaky task ${jobId} succeeded on attempt #${retryCount + 1}`,
  };
});

// Register 'always-fails' handler
registerHandler('always-fails', async (jobData, job) => {
  const jobId = (job && job.id) || (jobData && jobData.id) || 'unknown';
  const retryCount = Number(job?.retryCount ?? jobData?.retryCount ?? 0);
  console.log(
    `[Handler:always-fails] Processing job ${jobId} (retryCount: ${retryCount}). Triggering unconditional failure...`
  );
  throw new Error(`Unconditional failure on attempt #${retryCount + 1} for job ${jobId}`);
});

// Register 'crash-test' handler for hung/crashed worker simulation
const crashTestHandler = require('./crashTestHandler');
registerHandler('crash-test', crashTestHandler);

module.exports = {
  registerHandler,
  getHandler,
};
