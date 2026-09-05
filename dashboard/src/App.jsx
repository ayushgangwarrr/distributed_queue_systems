/**
 * dashboard/src/App.jsx
 *
 * Master Application Dashboard for the Distributed Priority Queue System.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { StatsCards } from './components/StatsCards';
import { JobsTable } from './components/JobsTable';
import { JobModal } from './components/JobModal';
import { EnqueueStudio } from './components/EnqueueStudio';
import { DLQManager } from './components/DLQManager';
import { WorkerFleet } from './components/WorkerFleet';
import { EventFeed } from './components/EventFeed';
import { ToastContainer } from './components/Toast';

import * as api from './services/api';
import { useWebSocket } from './services/useWebSocket';

export default function App() {
  // Navigation & Tabs
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'enqueue' | 'dlq' | 'workers' | 'stream'

  // REST State
  const [jobs, setJobs] = useState([]);
  const [totalJobs, setTotalJobs] = useState(0);
  const [jobsLimit] = useState(20);
  const [jobsOffset, setJobsOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');

  const [dlqJobs, setDlqJobs] = useState([]);
  const [totalDlq, setTotalDlq] = useState(0);
  const [dlqLimit] = useState(20);
  const [dlqOffset, setDlqOffset] = useState(0);

  const [restStats, setRestStats] = useState({ pending: 0, active: 0, delayed: 0, dlq: 0 });
  const [apiHealthy, setApiHealthy] = useState(true);
  const [redisConnected, setRedisConnected] = useState(true);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [isLoadingDLQ, setIsLoadingDLQ] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Selected Job for Drawer/Modal
  const [selectedJob, setSelectedJob] = useState(null);

  // Toasts
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((type, title, message) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 6);
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // WebSocket Live Stream Hook
  const {
    status: wsStatus,
    stats: wsStats,
    workers,
    events,
    clearEvents,
  } = useWebSocket();

  // Combine real-time WebSocket stats with REST stats fallback
  const combinedStats = {
    pending: wsStats?.pending ?? restStats.pending ?? 0,
    active: wsStats?.active ?? restStats.active ?? 0,
    delayed: wsStats?.delayed ?? restStats.delayed ?? 0,
    dlq: wsStats?.dlq ?? restStats.dlq ?? 0,
  };

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------

  const loadHealth = useCallback(async () => {
    try {
      const health = await api.getHealth();
      setApiHealthy(health.status === 'ok');
      setRedisConnected(health.redis === 'connected');
    } catch {
      setApiHealthy(false);
      setRedisConnected(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const stats = await api.getStats();
      setRestStats(stats);
    } catch {
      // Ignore background stats failure
    }
  }, []);

  const loadJobs = useCallback(async () => {
    setIsLoadingJobs(true);
    try {
      const res = await api.getJobs({
        limit: jobsLimit,
        offset: jobsOffset,
        status: statusFilter,
      });
      setJobs(res.jobs || []);
      setTotalJobs(res.total || 0);
    } catch (err) {
      addToast('error', 'Failed to load jobs', err.message);
    } finally {
      setIsLoadingJobs(false);
    }
  }, [jobsLimit, jobsOffset, statusFilter, addToast]);

  const loadDLQ = useCallback(async () => {
    setIsLoadingDLQ(true);
    try {
      const res = await api.getDLQ({
        limit: dlqLimit,
        offset: dlqOffset,
      });
      setDlqJobs(res.jobs || []);
      setTotalDlq(res.total || 0);
    } catch (err) {
      addToast('error', 'Failed to load DLQ', err.message);
    } finally {
      setIsLoadingDLQ(false);
    }
  }, [dlqLimit, dlqOffset, addToast]);

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.allSettled([loadHealth(), loadStats(), loadJobs(), loadDLQ()]);
    setIsRefreshing(false);
  }, [loadHealth, loadStats, loadJobs, loadDLQ]);

  // Initial mount load
  useEffect(() => {
    loadHealth();
    loadStats();
    loadJobs();
    loadDLQ();
  }, [loadHealth, loadStats, loadJobs, loadDLQ]);

  // Periodic background poll every 4s to guarantee sync even if WS is quiet
  useEffect(() => {
    const interval = setInterval(() => {
      loadHealth();
      loadStats();
      if (activeTab === 'overview') {
        loadJobs();
      } else if (activeTab === 'dlq') {
        loadDLQ();
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [activeTab, loadHealth, loadStats, loadJobs, loadDLQ]);

  // Inspect job by ID
  const handleSelectJobById = async (id) => {
    try {
      const job = await api.getJobById(id);
      setSelectedJob(job);
    } catch (err) {
      addToast('error', 'Job lookup failed', err.message);
    }
  };

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleEnqueue = async (jobPayload) => {
    try {
      const result = await api.enqueueJob(jobPayload);
      addToast('success', 'Job Enqueued Successfully', `UUID: ${result.id}`);
      setActiveTab('overview');
      loadJobs();
      loadStats();
    } catch (err) {
      addToast('error', 'Enqueue Failed', err.message);
    }
  };

  const handleBatchEnqueue = async (count = 5) => {
    try {
      const promises = [];
      const types = ['demo-task', 'flaky-task', 'always-fails'];
      for (let i = 0; i < count; i++) {
        const priority = Math.floor(Math.random() * 10) + 1;
        const type = types[i % types.length];
        promises.push(
          api.enqueueJob({
            type,
            data: { batchIndex: i + 1, timestamp: Date.now() },
            priority,
            maxRetries: 3,
          })
        );
      }
      await Promise.all(promises);
      addToast('success', 'Batch Enqueue Complete', `Injected ${count} jobs with random priorities.`);
      setActiveTab('overview');
      loadJobs();
      loadStats();
    } catch (err) {
      addToast('error', 'Batch Enqueue Failed', err.message);
    }
  };

  const handleCancelJob = async (id) => {
    try {
      await api.cancelJob(id);
      addToast('success', 'Job Cancelled', `Job ${id.substring(0, 8)}... cancelled`);
      loadJobs();
      loadStats();
    } catch (err) {
      addToast('error', 'Cancellation Failed', err.message);
    }
  };

  const handleRetryJob = async (id) => {
    try {
      await api.retryJob(id);
      addToast('success', 'Job Re-queued', `Job ${id.substring(0, 8)}... re-inserted into Pending`);
      loadJobs();
      loadDLQ();
      loadStats();
    } catch (err) {
      addToast('error', 'Retry Failed', err.message);
    }
  };

  const handleRetryDLQ = async (id) => {
    try {
      await api.retryDLQJob(id);
      addToast('success', 'Replayed from DLQ', `Job ${id.substring(0, 8)}... restored to queue`);
      loadDLQ();
      loadJobs();
      loadStats();
    } catch (err) {
      addToast('error', 'DLQ Retry Failed', err.message);
    }
  };

  const handlePurgeDLQ = async (id) => {
    try {
      await api.purgeDLQJob(id);
      addToast('success', 'Purged from DLQ', `Job ${id.substring(0, 8)}... deleted permanently`);
      loadDLQ();
      loadStats();
    } catch (err) {
      addToast('error', 'Purge Failed', err.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Toast Notification Layer */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Global Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        apiHealthy={apiHealthy}
        wsStatus={wsStatus}
        redisConnected={redisConnected}
        dlqCount={combinedStats.dlq}
        workerCount={workers.filter((w) => w.status !== 'offline').length}
        isRefreshing={isRefreshing}
        onRefresh={refreshAll}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Partition Metric Cards */}
        <StatsCards
          stats={combinedStats}
          workerCount={workers.filter((w) => w.status !== 'offline').length}
          onSelectTab={setActiveTab}
          onSelectFilter={(filter) => {
            setStatusFilter(filter);
            setJobsOffset(0);
          }}
        />

        {/* Tab Views */}
        {activeTab === 'overview' && (
          <JobsTable
            jobs={jobs}
            total={totalJobs}
            limit={jobsLimit}
            offset={jobsOffset}
            statusFilter={statusFilter}
            onFilterChange={(newFilter) => {
              setStatusFilter(newFilter);
              setJobsOffset(0);
            }}
            onPageChange={(newOffset) => setJobsOffset(newOffset)}
            onSelectJob={setSelectedJob}
            onCancelJob={handleCancelJob}
            onRetryJob={handleRetryJob}
            onOpenEnqueue={() => setActiveTab('enqueue')}
            isLoading={isLoadingJobs}
          />
        )}

        {activeTab === 'enqueue' && (
          <EnqueueStudio
            onEnqueue={handleEnqueue}
            onBatchEnqueue={handleBatchEnqueue}
          />
        )}

        {activeTab === 'dlq' && (
          <DLQManager
            jobs={dlqJobs}
            total={totalDlq}
            limit={dlqLimit}
            offset={dlqOffset}
            onPageChange={(newOffset) => setDlqOffset(newOffset)}
            onRetry={handleRetryDLQ}
            onPurge={handlePurgeDLQ}
            onSelectJob={setSelectedJob}
            isLoading={isLoadingDLQ}
          />
        )}

        {activeTab === 'workers' && (
          <WorkerFleet
            workers={workers}
            onSelectJobId={handleSelectJobById}
          />
        )}

        {activeTab === 'stream' && (
          <EventFeed
            events={events}
            onClear={clearEvents}
            onSelectJobId={handleSelectJobById}
          />
        )}
      </main>

      {/* Job Details Modal Drawer */}
      {selectedJob && (
        <JobModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onCancel={handleCancelJob}
          onRetry={handleRetryJob}
        />
      )}
    </div>
  );
}
