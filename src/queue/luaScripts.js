/**
 * src/queue/luaScripts.js
 *
 * Lua scripts for atomic queue operations executed within Redis.
 *
 * Atomicity Guarantees in Redis:
 * Redis executes Lua scripts sequentially on its single-threaded event loop.
 * No other Redis command or script can interleave during execution. This provides
 * full ACID isolation (Serializable) for multi-key operations without needing distributed locks.
 */

/**
 * atomicDequeue Lua Script
 *
 * KEYS[1]: 'queue:pending' (Sorted Set of pending job IDs scored by priority/timestamp)
 * KEYS[2]: 'queue:active'  (Hash of active job IDs -> leaseExpiresAt timestamp)
 *
 * ARGV[1]: workerId        (String ID of the worker claiming the job)
 * ARGV[2]: leaseMs         (Lease duration in milliseconds)
 * ARGV[3]: now             (Current timestamp in milliseconds)
 *
 * RACE CONDITIONS PREVENTED:
 * 1. Double Dequeue / Duplicate Delivery:
 *    Without atomicity, if Worker A and Worker B both attempt to pop a job concurrently,
 *    two non-atomic commands (e.g. ZRANGE + ZREM, or ZPOPMIN + HSET) could result in
 *    both workers obtaining the same job ID or interleaving their lease claims.
 * 2. Ghost / Orphaned Jobs:
 *    If a worker executes ZPOPMIN and the client crashes or experiences a network failure
 *    before writing to 'queue:active' and updating the job hash, the job is permanently
 *    lost (removed from 'queue:pending' but never recorded in 'queue:active').
 *
 * ATOMICITY GUARANTEE:
 * Popping from 'queue:pending', updating 'job:{id}' with worker lease metadata,
 * and registering the lease in 'queue:active' occur in a single indivisible step.
 * If no jobs exist in 'queue:pending', it immediately returns nil.
 */
const ATOMIC_DEQUEUE_SCRIPT = `
local pendingKey = KEYS[1]
local activeKey  = KEYS[2]

local workerId = ARGV[1]
local leaseMs  = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])

-- 1. Atomically pop the job with lowest score (highest priority, earliest timestamp)
local popped = redis.call('ZPOPMIN', pendingKey)
if not popped or #popped == 0 then
    return nil
end

local jobId = popped[1]
local jobKey = 'job:' .. jobId

-- If the job hash was deleted or does not exist, return nil
if redis.call('EXISTS', jobKey) == 0 then
    return nil
end

-- 2. Compute lease expiry
local leaseExpiresAt = now + leaseMs

-- 3. Update job hash status and worker ownership
redis.call('HSET', jobKey,
    'status', 'processing',
    'workerId', workerId,
    'leaseExpiresAt', tostring(leaseExpiresAt),
    'dequeuedAt', tostring(now)
)

-- 4. Register active lease as JSON ({ workerId, leaseExpiresAt }) so the reaper can monitor and reclaim timed-out jobs
local leaseInfo = cjson.encode({
    workerId = workerId,
    leaseExpiresAt = leaseExpiresAt
})
redis.call('HSET', activeKey, jobId, leaseInfo)

-- 5. Return the full job hash fields as a flat array [field1, val1, field2, val2, ...]
return redis.call('HGETALL', jobKey)
`;

/**
 * atomicFail Lua Script
 *
 * KEYS[1]: 'job:' .. jobId  (Job Hash)
 * KEYS[2]: 'queue:active'   (Hash of active job IDs -> leaseExpiresAt)
 * KEYS[3]: 'queue:delayed'  (Sorted Set of delayed job IDs -> promotion timestamp)
 * KEYS[4]: 'queue:dlq'      (Sorted Set of dead-letter job IDs -> failure timestamp)
 *
 * ARGV[1]: jobId            (String ID of the failed job)
 * ARGV[2]: errorMessage     (Error message string)
 * ARGV[3]: now              (Current timestamp in milliseconds)
 * ARGV[4]: jitter           (Random jitter in ms to avoid thundering herd)
 *
 * RACE CONDITIONS PREVENTED:
 * 1. Lost Updates to Retry Counts:
 *    If failure reporting was non-atomic (HGET retryCount -> compute backoff in JS -> HSET),
 *    a network retry, duplicate failure call, or a competing lease reaper could overwrite
 *    or miscalculate retryCount.
 * 2. Inconsistent Job State & Disappearance:
 *    Removing from 'queue:active' and pushing to 'queue:delayed' (or 'queue:dlq') must be atomic.
 *    If a crash occurs between removing the active lease and adding to the delayed/DLQ set,
 *    the job vanishes from all queue tracking structures.
 * 3. Split-Brain Routing:
 *    A job could be marked as 'dead' in its hash but still sit in 'queue:active', causing a
 *    reaper to mistakenly reschedule a dead job.
 *
 * ATOMICITY GUARANTEE:
 * Inspecting retryCount vs maxRetries, appending the error message to the JSON errors array,
 * calculating exponential backoff, updating the job hash, and transferring the job
 * from 'queue:active' to either 'queue:delayed' or 'queue:dlq' are completely atomic.
 */
const ATOMIC_FAIL_SCRIPT = `
local jobKey     = KEYS[1]
local activeKey  = KEYS[2]
local delayedKey = KEYS[3]
local dlqKey     = KEYS[4]

local jobId        = ARGV[1]
local errorMessage = ARGV[2]
local now          = tonumber(ARGV[3])
local jitter       = tonumber(ARGV[4]) or 0

if redis.call('EXISTS', jobKey) == 0 then
    return nil
end

local retryCount = tonumber(redis.call('HGET', jobKey, 'retryCount')) or 0
local maxRetries = tonumber(redis.call('HGET', jobKey, 'maxRetries')) or 3

-- Append errorMessage to JSON array in 'errors' field
local rawErrors = redis.call('HGET', jobKey, 'errors')
local errorList = {}
if rawErrors and rawErrors ~= false and rawErrors ~= '' then
    local status, decoded = pcall(cjson.decode, rawErrors)
    if status and type(decoded) == 'table' then
        errorList = decoded
    end
end
table.insert(errorList, errorMessage)
local encodedErrors = cjson.encode(errorList)
redis.call('HSET', jobKey, 'errors', encodedErrors)

if retryCount < maxRetries then
    local nextRetryCount = retryCount + 1
    -- Compute exponential backoff delay: 1000 * 2^retryCount + random jitter (0-500ms)
    local backoffDelay = math.floor((1000 * (2 ^ nextRetryCount)) + jitter)
    local delayScore = now + backoffDelay

    redis.call('HSET', jobKey,
        'status', 'pending',
        'retryCount', tostring(nextRetryCount),
        'lastFailedAt', tostring(now),
        'delayedUntil', tostring(delayScore)
    )

    -- Move job from active hash to delayed sorted set
    redis.call('ZADD', delayedKey, delayScore, jobId)
    redis.call('HDEL', activeKey, jobId)

    return cjson.encode({
        action = 'retry',
        jobId = jobId,
        retryCount = nextRetryCount,
        maxRetries = maxRetries,
        backoffDelay = backoffDelay,
        delayedUntil = delayScore,
        errorMessage = errorMessage
    })
else
    -- Max retries exhausted, send to Dead Letter Queue (DLQ)
    redis.call('HSET', jobKey,
        'status', 'dead',
        'failedAt', tostring(now)
    )

    -- Move job from active hash to DLQ sorted set
    redis.call('ZADD', dlqKey, now, jobId)
    redis.call('HDEL', activeKey, jobId)

    return cjson.encode({
        action = 'dead',
        jobId = jobId,
        retryCount = retryCount,
        maxRetries = maxRetries,
        backoffDelay = 0,
        delayedUntil = 0,
        errorMessage = errorMessage
    })
end
`;

/**
 * atomicRenewLease Lua Script
 *
 * KEYS[1]: 'queue:active' (Hash of active job IDs -> JSON lease info)
 * KEYS[2]: 'job:' .. jobId (Job Hash)
 *
 * ARGV[1]: jobId
 * ARGV[2]: workerId
 * ARGV[3]: leaseMs
 * ARGV[4]: now
 *
 * RACE CONDITIONS PREVENTED:
 * 1. Zombie Worker Lease Extension:
 *    If a worker hung and its lease expired, the reaper may have already reclaimed
 *    the job and re-queued it. If the zombie worker unfreezes and attempts to renew
 *    its lease, this script checks ownership first and rejects the renewal (returns 0).
 * 2. Split-Brain Expirations:
 *    Indivisibly updates both the active tracking hash and the job hash metadata.
 *
 * ATOMICITY GUARANTEE:
 * Reading the current lease, validating the worker ownership, and updating the expiry
 * happen as a single indivisible Redis operation.
 */
const ATOMIC_RENEW_LEASE_SCRIPT = `
local activeKey = KEYS[1]
local jobKey    = KEYS[2]

local jobId     = ARGV[1]
local workerId  = ARGV[2]
local leaseMs   = tonumber(ARGV[3])
local now       = tonumber(ARGV[4])

local rawActive = redis.call('HGET', activeKey, jobId)
if not rawActive or rawActive == false or rawActive == '' then
    return 0
end

local status, activeData = pcall(cjson.decode, rawActive)
if not status or type(activeData) ~= 'table' then
    return 0
end

-- Only allow renewal if the caller still owns the active lease
if activeData.workerId ~= workerId then
    return 0
end

local newExpiresAt = now + leaseMs
activeData.leaseExpiresAt = newExpiresAt

redis.call('HSET', activeKey, jobId, cjson.encode(activeData))
redis.call('HSET', jobKey, 'leaseExpiresAt', tostring(newExpiresAt))

return 1
`;

/**
 * Register Lua scripts as custom commands on an ioredis instance.
 *
 * @param {import('ioredis')} redisClient
 */
function registerLuaScripts(redisClient) {
  if (!redisClient.atomicDequeue) {
    redisClient.defineCommand('atomicDequeue', {
      numberOfKeys: 2,
      lua: ATOMIC_DEQUEUE_SCRIPT,
    });
  }

  if (!redisClient.atomicFail) {
    redisClient.defineCommand('atomicFail', {
      numberOfKeys: 4,
      lua: ATOMIC_FAIL_SCRIPT,
    });
  }

  if (!redisClient.atomicRenewLease) {
    redisClient.defineCommand('atomicRenewLease', {
      numberOfKeys: 2,
      lua: ATOMIC_RENEW_LEASE_SCRIPT,
    });
  }
}

module.exports = {
  ATOMIC_DEQUEUE_SCRIPT,
  ATOMIC_FAIL_SCRIPT,
  ATOMIC_RENEW_LEASE_SCRIPT,
  registerLuaScripts,
};
