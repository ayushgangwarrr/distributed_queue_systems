/**
 * src/events/eventBus.js
 *
 * Redis Pub/Sub wrapper serving as the internal event bus.
 * Uses dedicated subscriber connection to broadcast events to WebSocket and monitoring consumers.
 *
 * Event types:
 * - job:created
 * - job:started
 * - job:completed
 * - job:failed
 * - job:dead-lettered
 * - worker:heartbeat
 */

const Redis = require('ioredis');
const defaultRedis = require('../config/redis');

const CHANNEL = 'job-events';

// Publisher uses main redis client
const publisher = defaultRedis;

// Subscriber requires a dedicated Redis connection (cannot issue normal commands while subscribed)
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const subscriber = new Redis(redisUrl, {
  enableReadyCheck: true,
  lazyConnect: false,
});

subscriber.on('error', (err) => {
  console.warn('[EventBus Subscriber Warning]:', err.message);
});

let isSubscribed = false;
const listeners = new Set();

/**
 * Publish an event to the Redis event bus.
 *
 * @param {string} eventType - One of: job:created, job:started, job:completed, job:failed, job:dead-lettered, worker:heartbeat
 * @param {Object} payload - Event data
 */
async function publish(eventType, payload = {}) {
  try {
    const message = JSON.stringify({
      event: eventType,
      payload,
      timestamp: Date.now(),
    });
    await publisher.publish(CHANNEL, message);
  } catch (err) {
    console.warn(`[EventBus] Failed to publish ${eventType}:`, err.message);
  }
}

/**
 * Subscribe a callback to receive all events from the Redis event bus.
 *
 * @param {Function} callback - Function receiving { event, payload, timestamp }
 */
function subscribe(callback) {
  listeners.add(callback);

  if (!isSubscribed) {
    isSubscribed = true;
    subscriber.subscribe(CHANNEL, (err) => {
      if (err) {
        console.error(`[EventBus] Subscription error on channel ${CHANNEL}:`, err.message);
      }
    });

    subscriber.on('message', (channel, rawMessage) => {
      if (channel !== CHANNEL) return;
      try {
        const parsed = JSON.parse(rawMessage);
        listeners.forEach((fn) => {
          try {
            fn(parsed);
          } catch (listenerErr) {
            console.error('[EventBus Listener Error]:', listenerErr);
          }
        });
      } catch (jsonErr) {
        console.warn('[EventBus] Invalid JSON received:', rawMessage);
      }
    });
  }

  // Return unsubscribe function
  return () => {
    listeners.delete(callback);
  };
}

module.exports = {
  CHANNEL,
  publish,
  subscribe,
  publisher,
  subscriber,
};
