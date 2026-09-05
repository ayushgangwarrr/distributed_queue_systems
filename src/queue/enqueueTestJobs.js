/**
 * src/queue/enqueueTestJobs.js
 *
 * Standalone script to populate the queue with test jobs for the worker:
 * - 5 'demo-task' jobs with varying priorities (2, 5, 8, 9, 10)
 * - 1 'demo-task' job with shouldFail: true (priority 7)
 *
 * Run via: node src/queue/enqueueTestJobs.js
 */

const redis = require('../config/redis');
const PriorityQueue = require('./priorityQueue');

async function main() {
  console.log('===============================================================');
  console.log('             ENQUEUE TEST JOBS FOR WORKER                      ');
  console.log('===============================================================\n');

  const queue = new PriorityQueue(redis);

  const testJobs = [
    {
      type: 'demo-task',
      priority: 2,
      data: { taskName: 'Background cache cleanup', value: 100 },
      maxRetries: 3,
    },
    {
      type: 'demo-task',
      priority: 5,
      data: { taskName: 'Generate weekly usage report', value: 200 },
      maxRetries: 3,
    },
    {
      type: 'demo-task',
      priority: 8,
      data: { taskName: 'Customer invoice generation', value: 300 },
      maxRetries: 3,
    },
    {
      type: 'demo-task',
      priority: 9,
      data: { taskName: 'Password reset notification', value: 400 },
      maxRetries: 3,
    },
    {
      type: 'demo-task',
      priority: 10,
      data: { taskName: 'Critical security alert delivery', value: 500 },
      maxRetries: 3,
    },
    {
      type: 'demo-task',
      priority: 7,
      data: { taskName: 'Failing payment gateway call', shouldFail: true },
      maxRetries: 2,
    },
  ];

  console.log(`Enqueuing ${testJobs.length} test jobs into the priority queue...\n`);

  for (let i = 0; i < testJobs.length; i++) {
    const jobSpec = testJobs[i];
    const jobId = await queue.enqueue(jobSpec);
    console.log(
      `  [Enqueued #${i + 1}] ID: ${jobId} | Priority: ${jobSpec.priority.toString().padStart(2, ' ')} | Type: ${jobSpec.type} | FailFlag: ${!!jobSpec.data.shouldFail} | Description: ${jobSpec.data.taskName}`
    );
  }

  const stats = await queue.getStats();
  console.log('\n[Current Queue Stats]:');
  console.table(stats);

  console.log('\nJobs successfully enqueued!');
  console.log('Expected processing order by worker:');
  console.log('  1. Priority 10: Critical security alert delivery');
  console.log('  2. Priority  9: Password reset notification');
  console.log('  3. Priority  8: Customer invoice generation');
  console.log('  4. Priority  7: Failing payment gateway call (will fail and retry)');
  console.log('  5. Priority  5: Generate weekly usage report');
  console.log('  6. Priority  2: Background cache cleanup\n');

  await redis.quit();
}

main().catch((err) => {
  console.error('[Enqueue Error]:', err);
  process.exit(1);
});
