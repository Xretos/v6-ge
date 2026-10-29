/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { RefreshCw, Play, ShieldAlert, ShieldCheck, Zap, Sliders, CheckCircle2, XCircle } from 'lucide-react';
import { FrameEncoder, FSKModulator, FSKDemodulator, ModemConfig, DEFAULT_CONFIG, DecodedPacket } from '../dsp/fsk';

interface LoopbackViewProps {
  sampleRate: number;
}

export const LoopbackView: React.FC<LoopbackViewProps> = ({ sampleRate }) => {
  const [testMessage, setTestMessage] = useState('LOOPBACK_TEST_MSG_42');
  const [baudRate, setBaudRate] = useState<number>(100);
  const [noiseLevel, setNoiseLevel] = useState<number>(15); // Noise amplitude (0 - 50%)
  const [injectBitFlips, setInjectBitFlips] = useState<boolean>(true);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  // Results comparison
  const [fecResult, setFecResult] = useState<{
    success: boolean;
    text?: string;
    corrections: number;
    crcValid: boolean;
    durationMs: number;
  } | null>(null);

  const [noFecResult, setNoFecResult] = useState<{
    success: boolean;
    text?: string;
    crcValid: boolean;
    durationMs: number;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const runComparisonTest = () => {
    setIsRunning(true);

    const markFreq = baudRate === 2000 ? 2000 : baudRate === 1000 ? 2000 : baudRate === 500 ? 1500 : 1200;
    const spaceFreq = baudRate === 2000 ? 4000 : baudRate === 1000 ? 3000 : baudRate === 500 ? 2500 : 2200;

    const config: ModemConfig = {
      sampleRate,
      baudRate,
      markFreq,
      spaceFreq,
      amplitude: 0.8,
      useFEC: true,
    };

    const payload = new TextEncoder().encode(testMessage);

    // 1. Run WITH FEC
    const t0 = performance.now();
    const bitsWithFEC = FrameEncoder.encodePacketToBits(payload, 1, true);

    // Simulate bit flip if requested
    if (injectBitFlips && bitsWithFEC.length > 50) {
      // Flip one bit in payload
      const flipIdx = 45;
      bitsWithFEC[flipIdx] ^= 1;
    }

    const audioWithFEC = FSKModulator.modulate(bitsWithFEC, config);

    // Add AWGN noise
    const noisyAudioWithFEC = addNoiseToAudio(audioWithFEC, noiseLevel / 100);

    const demodFEC = new FSKDemodulator(config);
    const decodedFECList = demodFEC.processAudioBuffer(noisyAudioWithFEC);
    const t1 = performance.now();

    if (decodedFECList.length > 0) {
      const pkt = decodedFECList[0];
      setFecResult({
        success: pkt.crcValid,
        text: pkt.text,
        corrections: pkt.fecCorrections,
        crcValid: pkt.crcValid,
        durationMs: Math.round(t1 - t0),
      });
    } else {
      setFecResult({
        success: false,
        text: '未检测到有效同步字 (帧丢失)',
        corrections: 0,
        crcValid: false,
        durationMs: Math.round(t1 - t0),
      });
    }

    // 2. Run WITHOUT FEC
    const t2 = performance.now();
    const bitsNoFEC = FrameEncoder.encodePacketToBits(payload, 2, false);

    if (injectBitFlips && bitsNoFEC.length > 40) {
      const flipIdx = 36;
      bitsNoFEC[flipIdx] ^= 1;
    }

    const configNoFEC = { ...config, useFEC: false };
    const audioNoFEC = FSKModulator.modulate(bitsNoFEC, configNoFEC);
    const noisyAudioNoFEC = addNoiseToAudio(audioNoFEC, noiseLevel / 100);

    const demodNoFEC = new FSKDemodulator(configNoFEC);
    const decodedNoFECList = demodNoFEC.processAudioBuffer(noisyAudioNoFEC);
    const t3 = performance.now();

    if (decodedNoFECList.length > 0) {
      const pkt = decodedNoFECList[0];
      setNoFecResult({
        success: pkt.crcValid,
        text: pkt.text,
        crcValid: pkt.crcValid,
        durationMs: Math.round(t3 - t2),
      });
    } else {
      setNoFecResult({
        success: false,
        text: '未检测到有效同步字 (帧丢失)',
        crcValid: false,
        durationMs: Math.round(t3 - t2),
      });
    }

    // Draw noisy waveform
    drawNoisyWaveform(noisyAudioWithFEC);
    setIsRunning(false);
  };

  const addNoiseToAudio = (input: Float32Array, noiseAmp: number): Float32Array => {
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      // Gaussian Box-Muller noise
      const u1 = Math.max(1e-9, Math.random());
      const u2 = Math.random();
      const gaussian = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      output[i] = input[i] + gaussian * noiseAmp;
    }
    return output;
  };

  const drawNoisyWaveform = (samples: Float32Array) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#070a12';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    const step = Math.max(1, Math.floor(samples.length / width));
    for (let x = 0; x < width; x++) {
      const idx = x * step;
      const val = samples[idx] || 0;
      const y = (0.5 - val * 0.4) * height;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = canvas.clientWidth * window.devicePixelRatio;
      canvas.height = canvas.clientHeight * window.devicePixelRatio;
    }
    runComparisonTest();
  }, []);

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-950 border border-cyan-800/60 text-cyan-400">
            <RefreshCw className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">单机内部全双工回环与信道抗噪测试</h2>
            <p className="text-xs text-slate-400">
              无需插线即可在浏览器内存中运行调制、信道加性高斯白噪声 (AWGN) 注入与解调全流程
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Controls */}
        <div className="lg:col-span-6 space-y-5">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-white border-b border-slate-800 pb-2">
              仿真信道参数 (Channel Simulation)
            </h3>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">测试测试载荷文本</label>
              <input
                type="text"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">调制波特率</label>
                <select
                  value={baudRate}
                  onChange={(e) => setBaudRate(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
                >
                  <option value={100}>100 bps (标准抗噪)</option>
                  <option value={200}>200 bps (2倍速)</option>
                  <option value={500}>500 bps (5倍速)</option>
                  <option value={1000}>1000 bps (⚡ 10倍速 Turbo)</option>
                  <option value={2000}>2000 bps (🔥 20倍速 Extreme)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">信道误码扰动注入</label>
                <button
                  type="button"
                  onClick={() => setInjectBitFlips(!injectBitFlips)}
                  className={`w-full py-2 px-3 rounded-lg text-xs font-medium border transition cursor-pointer ${
                    injectBitFlips
                      ? 'bg-amber-950/60 border-amber-700/80 text-amber-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  {injectBitFlips ? '已使能单比特翻转扰动' : '无额外比特扰动'}
                </button>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-300">加性高斯白噪声强度 (AWGN Level):</span>
                <span className="font-mono text-cyan-400">{noiseLevel}% (SNR ≈ {Math.max(0, Math.round(20 * Math.log10(100 / (noiseLevel || 1))))} dB)</span>
              </div>
              <input
                type="range"
                min="0"
                max="45"
                value={noiseLevel}
                onChange={(e) => setNoiseLevel(Number(e.target.value))}
                className="w-full accent-cyan-500 cursor-pointer"
              />
              <p className="text-[11px] text-slate-500 mt-1">模拟劣质音频对录线、杂散电磁感应或接触不良引起的信噪比下降</p>
            </div>

            <button
              type="button"
              disabled={isRunning}
              onClick={runComparisonTest}
              className="w-full bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold py-3 px-4 rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 transition cursor-pointer"
            >
              <Zap className="w-4 h-4" />
              <span>运行前向纠错 (FEC) 对比压测</span>
            </button>
          </div>

          {/* Waveform Canvas */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-semibold text-white">仿真含噪信道时域波形</h3>
            <div className="rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
              <canvas ref={canvasRef} className="w-full h-32 block" />
            </div>
            <p className="text-[11px] text-slate-400">波形展示了经过信道加噪后的 CPFSK 模拟信号，接收端正交匹配滤波器需从中提取出正确的比特流。</p>
          </div>
        </div>

        {/* Results Comparison: FEC vs No-FEC */}
        <div className="lg:col-span-6 space-y-5">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-white border-b border-slate-800 pb-2">
              纠错能力实测对比 (FEC Benchmarking)
            </h3>

            {/* WITH FEC */}
            <div className={`p-4 rounded-xl border ${
              fecResult?.success ? 'bg-emerald-950/20 border-emerald-800/60' : 'bg-red-950/20 border-red-900/60'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <span className="text-sm font-bold text-white">Hamming(7,4) 前向纠错开启</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded font-mono font-bold ${
                  fecResult?.success ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-red-950 text-red-300 border border-red-800'
                }`}>
                  {fecResult?.success ? '✓ 传输成功 (PASS)' : '✗ 校验失败 (FAIL)'}
                </span>
              </div>

              <div className="text-xs space-y-1.5 text-slate-300">
                <div className="flex justify-between">
                  <span>纠正错误比特数:</span>
                  <span className="font-mono text-cyan-400 font-bold">{fecResult?.corrections ?? 0} 位</span>
                </div>
                <div className="flex justify-between">
                  <span>CRC-16 校验状态:</span>
                  <span className="font-mono text-emerald-400">{fecResult?.crcValid ? '0x1021 校验通过' : '校验码不符'}</span>
                </div>
                <div className="flex justify-between">
                  <span>解调还原内容:</span>
                  <span className="font-mono text-white bg-slate-900/80 px-2 py-0.5 rounded">{fecResult?.text || '无数据'}</span>
                </div>
              </div>
            </div>

            {/* WITHOUT FEC */}
            <div className={`p-4 rounded-xl border ${
              noFecResult?.success ? 'bg-emerald-950/20 border-emerald-800/60' : 'bg-red-950/20 border-red-900/60'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-400" />
                  <span className="text-sm font-bold text-white">无 FEC (原始直通直传)</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded font-mono font-bold ${
                  noFecResult?.success ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-red-950 text-red-300 border border-red-800'
                }`}>
                  {noFecResult?.success ? '✓ 传输成功 (PASS)' : '✗ 丢包拦截 (FAIL)'}
                </span>
              </div>

              <div className="text-xs space-y-1.5 text-slate-300">
                <div className="flex justify-between">
                  <span>纠错机制:</span>
                  <span className="font-mono text-slate-500">无 (0 纠错能力)</span>
                </div>
                <div className="flex justify-between">
                  <span>CRC-16 校验状态:</span>
                  <span className={`font-mono ${noFecResult?.crcValid ? 'text-emerald-400' : 'text-red-400'}`}>
                    {noFecResult?.crcValid ? '校验通过' : '检测到比特损坏 (拦截丢弃)'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>解调还原内容:</span>
                  <span className="font-mono text-white bg-slate-900/80 px-2 py-0.5 rounded">{noFecResult?.text || '已丢弃损坏帧'}</span>
                </div>
              </div>
            </div>

            {/* Analytical takeaway */}
            <div className="text-xs text-slate-400 bg-slate-950/80 p-4 rounded-xl border border-slate-800 leading-relaxed space-y-2">
              <div className="font-semibold text-slate-200">🔍 测试结论分析：</div>
              <p>
                在 3.5mm 音频对录线这种存在接触电位差、线缆屏蔽损耗和手机麦克风前置放大器热噪声的物理介质中，单比特突发误码极易发生。
              </p>
              <p>
                <b>未启用 FEC 时：</b> 只要有 1 个采样点或过零点被噪声污染，CRC-16 即判定整帧报废，造成高丢包率；
              </p>
              <p>
                <b>启用 Hamming(7,4) 时：</b> 依靠纠错伴随式 $S = (s_3 s_2 s_1)_2$ 精确反转被干扰的比特，整包数据能够 100% 无损救回，大大提升了耳机孔传输的鲁棒性。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
