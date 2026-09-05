/**
 * dashboard/src/components/Navbar.jsx
 *
 * Top navigation bar with system status indicators, tab switches, and manual refresh controls.
 */

import React from 'react';
import {
  Layers,
  Activity,
  PlusCircle,
  AlertTriangle,
  Cpu,
  RefreshCw,
  Radio,
  Server,
  Database,
} from 'lucide-react';

export function Navbar({
  activeTab,
  setActiveTab,
  apiHealthy,
  wsStatus,
  redisConnected,
  dlqCount = 0,
  workerCount = 0,
  isRefreshing,
  onRefresh,
}) {
  const tabs = [
    { id: 'overview', label: 'Overview & Jobs', icon: Layers },
    { id: 'enqueue', label: 'Enqueue Studio', icon: PlusCircle },
    { id: 'dlq', label: 'Dead Letter Queue', icon: AlertTriangle, badge: dlqCount, badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
    { id: 'workers', label: 'Worker Fleet', icon: Cpu, badge: workerCount, badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
    { id: 'stream', label: 'Live Stream', icon: Activity, live: true },
  ];

  return (
    <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-0.5 shadow-lg shadow-indigo-500/20 flex items-center justify-center">
              <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                <Radio className="w-5 h-5 text-indigo-400 animate-pulse" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                  PriorityQueue
                </span>
                <span className="text-[10px] uppercase font-mono tracking-widest px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Cluster v1.0
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono hidden sm:block">
                Redis-backed distributed engine with Lua leases
              </p>
            </div>
          </div>

          {/* System Health Indicators */}
          <div className="hidden md:flex items-center gap-2.5 bg-slate-900/60 border border-slate-800 rounded-full px-3 py-1.5 shadow-inner">
            {/* API Status */}
            <div className="flex items-center gap-1.5 text-xs">
              <Server className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-400">API:</span>
              <span className={`inline-flex items-center gap-1 font-medium ${apiHealthy ? 'text-emerald-400' : 'text-rose-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${apiHealthy ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' : 'bg-rose-400'}`} />
                {apiHealthy ? '3000' : 'Down'}
              </span>
            </div>

            <div className="w-px h-3.5 bg-slate-800" />

            {/* WebSocket Stream */}
            <div className="flex items-center gap-1.5 text-xs">
              <Radio className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-400">Stream:</span>
              <span className={`inline-flex items-center gap-1 font-medium ${wsStatus === 'connected' ? 'text-emerald-400' : wsStatus === 'connecting' ? 'text-amber-400' : 'text-rose-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'connected' ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50 pulse-glow' : wsStatus === 'connecting' ? 'bg-amber-400' : 'bg-rose-400'}`} />
                {wsStatus === 'connected' ? '4000' : wsStatus}
              </span>
            </div>

            <div className="w-px h-3.5 bg-slate-800" />

            {/* Redis Status */}
            <div className="flex items-center gap-1.5 text-xs">
              <Database className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-400">Redis:</span>
              <span className={`inline-flex items-center gap-1 font-medium ${redisConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${redisConnected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                {redisConnected ? 'OK' : 'Fail'}
              </span>
            </div>
          </div>

          {/* Controls: Refresh */}
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refresh queue data"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
              <span className="hidden sm:inline">Sync</span>
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="flex space-x-1 sm:space-x-2 overflow-x-auto py-2 scrollbar-none border-t border-slate-900">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg transition-all whitespace-nowrap relative ${
                  isActive
                    ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30 shadow-sm shadow-indigo-950'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                <span>{tab.label}</span>

                {/* Optional count badge */}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full border font-mono ${tab.badgeColor}`}>
                    {tab.badge}
                  </span>
                )}

                {/* Optional live dot */}
                {tab.live && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-glow" />
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
