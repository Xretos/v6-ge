/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Radio, Download, Activity, Cable, FileText, Cpu, RefreshCw } from 'lucide-react';

export type ActiveTab = 'transmitter' | 'receiver' | 'loopback' | 'hardware' | 'protocol' | 'deployment';

interface NavbarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  sampleRate: number;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab, sampleRate }) => {
  const tabs = [
    { id: 'transmitter', label: '发送端 (TX)', icon: Radio },
    { id: 'receiver', label: '接收端 (RX)', icon: Activity },
    { id: 'loopback', label: '回环与抗噪测试', icon: RefreshCw },
    { id: 'hardware', label: '3.5mm硬件接线指南', icon: Cable },
    { id: 'protocol', label: '协议与基准报告', icon: Cpu },
    { id: 'deployment', label: 'GitHub Pages部署', icon: Download },
  ];

  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-500 p-0.5 shadow-lg shadow-cyan-500/20">
                <div className="h-full w-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                  <Radio className="w-5 h-5 text-cyan-400 animate-pulse" />
                </div>
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                  AudioJack FSK Modem
                  <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-400 border border-cyan-800/80 font-mono">
                    v1.0 开源版
                  </span>
                </h1>
                <p className="text-xs text-slate-400">
                  3.5mm 耳机孔模拟音频对录线数字通信系统 (Android Web Audio)
                </p>
              </div>
            </div>

            <div className="flex md:hidden items-center gap-2">
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                Fs: {sampleRate}Hz
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <nav className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 scrollbar-none w-full md:w-auto">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as ActiveTab)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                      isActive
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm shadow-cyan-500/10'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="hidden md:flex items-center gap-2 border-l border-slate-800 pl-3">
              <span className="text-xs font-mono px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                Fs: {sampleRate} Hz
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
