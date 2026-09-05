/**
 * src/workers/crashTestHandler.js
 *
 * Special test handler for simulating a frozen or hung worker process.
 * Awaits an unresolving Promise so the worker becomes completely unresponsive,
 * ceases renewing its lease, and allows testing the lease expiry and reaper recovery path.
 */

async function crashTestHandler(jobData, job) {
  const jobId = (job && job.id) || (jobData && jobData.id) || 'unknown';

  console.log(
    `\n===============================================================`
  );
  console.log(
    `[Handler:crash-test] Worker about to hang on job ${jobId}!`
  );
  console.log(
    `[Handler:crash-test] Awaiting an unresolving Promise to simulate a dead/hung worker process.`
  );
  console.log(
    `[Handler:crash-test] The lease will NOT be renewed and the reaper is expected to reclaim it.`
  );
  console.log(
    `===============================================================\n`
  );

  // Return a promise that never resolves or rejects
  return new Promise(() => {});
}

module.exports = crashTestHandler;
