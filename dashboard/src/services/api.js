/**
 * dashboard/src/services/api.js
 *
 * REST API client for Distributed Priority Queue backend.
 * Uses relative URLs which work seamlessly via Vite proxy during development
 * and via Express static hosting in production.
 */

const API_BASE = '';

/**
 * Generic JSON fetch wrapper with error handling
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const defaultHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  const response = await fetch(url, config);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg = data?.message || data?.error || `Request failed with status ${response.status}`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.details = data?.details;
    throw error;
  }

  return data;
}

// Queue Partition Stats & System Health
export const getStats = () => request('/queues/stats');
export const getHealth = () => request('/health');
export const getThroughput = (windowMinutes = 60) => request(`/stats/throughput?windowMinutes=${windowMinutes}`);

// Job Operations
export const getJobs = ({ limit = 20, offset = 0, status = '' } = {}) => {
  const params = new URLSearchParams();
  if (limit) params.append('limit', limit.toString());
  if (offset) params.append('offset', offset.toString());
  if (status && status !== 'all') params.append('status', status);
  return request(`/jobs?${params.toString()}`);
};

export const getJobById = (id) => request(`/jobs/${encodeURIComponent(id)}`);

export const enqueueJob = ({ type, data, priority = 5, maxRetries = 3 }) =>
  request('/jobs', {
    method: 'POST',
    body: JSON.stringify({
      type: type || 'default',
      data: typeof data === 'object' ? data : {},
      priority: Number(priority),
      maxRetries: Number(maxRetries),
    }),
  });

export const cancelJob = (id) =>
  request(`/jobs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

export const retryJob = (id) =>
  request(`/jobs/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
  });

// Dead Letter Queue (DLQ) Operations
export const getDLQ = ({ limit = 20, offset = 0 } = {}) => {
  const params = new URLSearchParams();
  if (limit) params.append('limit', limit.toString());
  if (offset) params.append('offset', offset.toString());
  return request(`/dlq?${params.toString()}`);
};

export const retryDLQJob = (id) =>
  request(`/dlq/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
  });

export const purgeDLQJob = (id) =>
  request(`/dlq/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
