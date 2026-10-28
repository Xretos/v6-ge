/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navbar, ActiveTab } from './components/Navbar';
import { TransmitterView } from './components/TransmitterView';
import { ReceiverView } from './components/ReceiverView';
import { LoopbackView } from './components/LoopbackView';
import { HardwareGuideView } from './components/HardwareGuideView';
import { ProtocolBenchmarkView } from './components/ProtocolBenchmarkView';
import { DeploymentGuideView } from './components/DeploymentGuideView';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('transmitter');
  const [sampleRate, setSampleRate] = useState<number>(48000);
  const [syntheticFeed, setSyntheticFeed] = useState<Float32Array | null>(null);

  // Initialize sample rate adaptively
  useEffect(() => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const dummyCtx = new AudioCtx();
        setSampleRate(dummyCtx.sampleRate);
        dummyCtx.close();
      }
    } catch {
      setSampleRate(48000);
    }
  }, []);

  const handleAudioBufferGenerated = (buffer: Float32Array) => {
    // If user transmits while receiver might be active or in testing, pass it along
    setSyntheticFeed(buffer);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Navigation Header */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        sampleRate={sampleRate}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {activeTab === 'transmitter' && (
          <TransmitterView
            sampleRate={sampleRate}
            onAudioBufferGenerated={handleAudioBufferGenerated}
          />
        )}

        {activeTab === 'receiver' && (
          <ReceiverView
            sampleRate={sampleRate}
            syntheticAudioFeed={syntheticFeed}
          />
        )}

        {activeTab === 'loopback' && (
          <LoopbackView
            sampleRate={sampleRate}
          />
        )}

        {activeTab === 'hardware' && (
          <HardwareGuideView />
        )}

        {activeTab === 'protocol' && (
          <ProtocolBenchmarkView />
        )}

        {activeTab === 'deployment' && (
          <DeploymentGuideView />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 text-xs text-slate-500 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <span>AudioJack FSK Modem · 3.5mm 音频孔模拟调制通信系统 (开源)</span>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span>CPFSK 连续相位</span>
            <span>·</span>
            <span>Hamming(7,4) FEC</span>
            <span>·</span>
            <span>CRC-16-CCITT</span>
            <span>·</span>
            <span>Web Audio API 原生驱动</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
