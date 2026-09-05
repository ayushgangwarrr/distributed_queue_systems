/**
 * dashboard/src/components/StatsCards.jsx
 *
 * Glassmorphic stat cards displaying partition counts and worker fleet size.
 */

import React from 'react';
import { Layers, Zap, Clock, AlertOctagon, Cpu, ArrowUpRight } from 'lucide-react';

export function StatsCards({ stats = {}, workerCount = 0, onSelectFilter, onSelectTab }) {
  const cards = [
    {
      id: 'pending',
      label: 'Pending (ZSET)',
      subtitle: 'Deterministic priority queue',
      value: stats.pending ?? 0,
      icon: Layers,
      color: 'from-violet-500/20 to-indigo-500/10 border-indigo-500/30 text-indigo-400',
      iconBg: 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30',
      glow: 'group-hover:border-indigo-500/50',
      action: () => {
        if (onSelectTab) onSelectTab('overview');
        if (onSelectFilter) onSelectFilter('pending');
      },
    },
    {
      id: 'active',
      label: 'Active (Leased)',
      subtitle: 'Worker heartbeat protected',
      value: stats.active ?? 0,
      icon: Zap,
      color: 'from-cyan-500/20 to-blue-500/10 border-cyan-500/30 text-cyan-400',
      iconBg: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30',
      glow: 'group-hover:border-cyan-500/50',
      action: () => {
        if (onSelectTab) onSelectTab('overview');
        if (onSelectFilter) onSelectFilter('processing');
      },
    },
    {
      id: 'delayed',
      label: 'Delayed (Backoff)',
      subtitle: 'Exponential jitter retry',
      value: stats.delayed ?? 0,
      icon: Clock,
      color: 'from-amber-500/20 to-orange-500/10 border-amber-500/30 text-amber-400',
      iconBg: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
      glow: 'group-hover:border-amber-500/50',
      action: () => {
        if (onSelectTab) onSelectTab('overview');
        if (onSelectFilter) onSelectFilter('delayed');
      },
    },
    {
      id: 'dlq',
      label: 'Dead Letter Queue',
      subtitle: 'Exhausted retries',
      value: stats.dlq ?? 0,
      icon: AlertOctagon,
      color: 'from-rose-500/20 to-red-500/10 border-rose-500/30 text-rose-400',
      iconBg: 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
      glow: 'group-hover:border-rose-500/50',
      action: () => {
        if (onSelectTab) onSelectTab('dlq');
      },
    },
    {
      id: 'workers',
      label: 'Worker Fleet',
      subtitle: 'Autonomous consumers',
      value: workerCount,
      icon: Cpu,
      color: 'from-emerald-500/20 to-teal-500/10 border-emerald-500/30 text-emerald-400',
      iconBg: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
      glow: 'group-hover:border-emerald-500/50',
      action: () => {
        if (onSelectTab) onSelectTab('workers');
      },
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 sm:gap-4 mb-6">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.id}
            onClick={card.action}
            className={`group relative overflow-hidden rounded-2xl bg-gradient-to-b ${card.color} border p-4.5 sm:p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl cursor-pointer ${card.glow}`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className={`p-2.5 rounded-xl ${card.iconBg}`}>
                <Icon className="w-5 h-5" />
              </div>
              <ArrowUpRight className="w-4 h-4 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>

            <div className="space-y-1">
              <div className="text-2xl sm:text-3xl font-bold tracking-tight text-white font-mono">
                {card.value.toLocaleString()}
              </div>
              <div className="text-xs font-semibold text-slate-200">
                {card.label}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {card.subtitle}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
