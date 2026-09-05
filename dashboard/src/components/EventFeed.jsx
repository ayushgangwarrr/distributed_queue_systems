/**
 * dashboard/src/components/EventFeed.jsx
 *
 * Real-time streaming log of WebSocket events with pause, clear, and filter controls.
 */

import React, { useState } from 'react';
import {
  Activity,
  PlusCircle,
  Zap,
  CheckCircle,
  AlertTriangle,
  Skull,
  Heart,
  Trash2,
  Pause,
  Play,
  Filter,
} from 'lucide-react';

export function EventFeed({ events = [], onClear, onSelectJobId }) {
  const [filter, setFilter] = useState('all'); // 'all' | 'jobs' | 'errors' | 'heartbeats'
  const [isPaused, setIsPaused] = useState(false);

  const getEventBadge = (eventName) => {
    switch (eventName) {
      case 'job:created':
        return {
          icon: PlusCircle,
          label: 'job:created',
          color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
        };
      case 'job:started':
        return {
          icon: Zap,
          label: 'job:started',
          color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
        };
      case 'job:completed':
        return {
          icon: CheckCircle,
          label: 'job:completed',
          color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        };
      case 'job:failed':
        return {
          icon: AlertTriangle,
          label: 'job:failed',
          color: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        };
      case 'job:dead-lettered':
        return {
          icon: Skull,
          label: 'job:dead-lettered',
          color: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
        };
      case 'worker:heartbeat':
        return {
          icon: Heart,
          label: 'worker:heartbeat',
          color: 'bg-slate-800 text-slate-400 border-slate-700',
        };
      default:
        return {
          icon: Activity,
          label: eventName,
          color: 'bg-slate-800 text-slate-300 border-slate-700',
        };
    }
  };

  const filteredEvents = events.filter((e) => {
    if (filter === 'jobs') return e.event?.startsWith('job:');
    if (filter === 'errors') return e.event === 'job:failed' || e.event === 'job:dead-lettered';
    if (filter === 'heartbeats') return e.event === 'worker:heartbeat';
    return true;
  });

  const formatTimestamp = (ts) => {
    return new Date(ts).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  return (
    <div className="glass-panel rounded-2xl border border-slate-800 shadow-xl overflow-hidden flex flex-col h-[650px]">
      {/* Stream Controls Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/60 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-400 animate-pulse" />
          <h2 className="text-sm font-bold text-white tracking-tight">
            WebSocket Live Telemetry Stream
          </h2>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            {events.length} Buffered Events
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Filters */}
          <div className="flex items-center bg-slate-950 rounded-lg p-1 border border-slate-800 text-xs">
            {['all', 'jobs', 'errors', 'heartbeats'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded-md capitalize font-medium transition-colors ${
                  filter === f
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Pause / Resume */}
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`p-1.5 rounded-lg border text-xs font-medium transition-colors ${
              isPaused
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
            }`}
            title={isPaused ? 'Resume stream' : 'Pause stream'}
          >
            {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>

          {/* Clear */}
          <button
            onClick={onClear}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            title="Clear buffer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Events Log Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs divide-y divide-slate-800/40">
        {filteredEvents.length === 0 ? (
          <div className="text-center py-24 text-slate-500">
            <Activity className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
            Waiting for live event bus activity on ws://localhost:4000...
          </div>
        ) : (
          filteredEvents.map((evt) => {
            const badge = getEventBadge(evt.event);
            const Icon = badge.icon;
            const jobId = evt.payload?.jobId || evt.payload?.id;
            const workerId = evt.payload?.workerId;

            return (
              <div
                key={evt.id}
                className="pt-2 flex items-start gap-3 hover:bg-slate-800/20 p-2 rounded-xl transition-colors"
              >
                <span className="text-[11px] text-slate-500 shrink-0 select-none">
                  {formatTimestamp(evt.timestamp)}
                </span>

                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border font-mono font-semibold shrink-0 ${badge.color}`}
                >
                  <Icon className="w-3 h-3" />
                  {badge.label}
                </span>

                <div className="flex-1 min-w-0 text-slate-300">
                  {jobId && (
                    <span className="mr-2">
                      Job:{' '}
                      <button
                        onClick={() => onSelectJobId && onSelectJobId(jobId)}
                        className="text-indigo-400 hover:underline hover:text-indigo-300 font-bold"
                      >
                        {jobId.substring(0, 8)}...
                      </button>
                    </span>
                  )}
                  {workerId && (
                    <span className="mr-2 text-cyan-400">@{workerId}</span>
                  )}
                  {evt.payload?.error && (
                    <span className="text-rose-400 ml-1 truncate">
                      {typeof evt.payload.error === 'object'
                        ? evt.payload.error.message || JSON.stringify(evt.payload.error)
                        : evt.payload.error}
                    </span>
                  )}
                  {evt.payload?.durationMs && (
                    <span className="text-emerald-400 ml-1">
                      in {evt.payload.durationMs}ms
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
