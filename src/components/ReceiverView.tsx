/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Activity, ExternalLink, ShieldAlert, CheckCircle, AlertTriangle, Trash2, Cpu, BarChart2 } from 'lucide-react';
import { FSKDemodulator, DecodedPacket, DEFAULT_CONFIG } from '../dsp/fsk';

interface ReceiverViewProps {
  sampleRate: number;
  syntheticAudioFeed?: Float32Array | null;
}

export const ReceiverView: React.FC<ReceiverViewProps> = ({ sampleRate, syntheticAudioFeed }) => {
  const [isListening, setIsListening] = useState(false);
  const [baudRate, setBaudRate] = useState<number>(100);
  const [snrDb, setSnrDb] = useState<number>(0);
  const [rmsDb, setRmsDb] = useState<number>(-96);
  const [isClipping, setIsClipping] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('等待启动耳机孔输入监听...');

  // Packet & Loss Stats
  const [packets, setPackets] = useState<DecodedPacket[]>([]);
  const [validCount, setValidCount] = useState<number>(0);
  const [corruptedCount, setCorruptedCount] = useState<number>(0);
  const [totalFecCorrections, setTotalFecCorrections] = useState<number>(0);

  // Audio nodes & Canvas refs
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);
  const specCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const demodulatorRef = useRef<FSKDemodulator | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Audio ring buffer for streaming demodulation
  const ringBufferRef = useRef<Float32Array>(new Float32Array(48000));
  const writeIdxRef = useRef<number>(0);
  const totalSamplesRef = useRef<number>(0);
  const lastProcessedRef = useRef<number>(0);

  // Initialize demodulator
  useEffect(() => {
    const demod = new FSKDemodulator({
      sampleRate,
      baudRate,
      markFreq: 1200,
      spaceFreq: 2200,
      useFEC: true,
    });

    demod.setOnSignalQuality((quality) => {
      setSnrDb(Math.round(quality.snrDb));
      const db = quality.rms > 0.0001 ? Math.max(-96, 20 * Math.log10(quality.rms)) : -96;
      setRmsDb(Math.round(db));
      setIsClipping(quality.rms > 0.95);
    });

    demodulatorRef.current = demod;
  }, [sampleRate, baudRate]);

  // Support direct synthetic audio injection (from loopback tab or tests)
  useEffect(() => {
    if (syntheticAudioFeed && demodulatorRef.current) {
      const decodedPackets = demodulatorRef.current.processAudioBuffer(syntheticAudioFeed);
      if (decodedPackets.length > 0) {
        for (const pkt of decodedPackets) {
          handleNewPacket(pkt);
        }
      }
    }
  }, [syntheticAudioFeed]);

  const handleNewPacket = useCallback((pkt: DecodedPacket) => {
    setPackets((prev) => [pkt, ...prev.slice(0, 49)]);
    if (pkt.crcValid) {
      setValidCount((prev) => prev + 1);
    } else {
      setCorruptedCount((prev) => prev + 1);
    }
    if (pkt.fecCorrections > 0) {
      setTotalFecCorrections((prev) => prev + pkt.fecCorrections);
    }
  }, []);

  // Visualizer loop for Oscilloscope & Spectrum
  const startVisualizer = useCallback(() => {
    const waveCanvas = waveCanvasRef.current;
    const specCanvas = specCanvasRef.current;
    if (!waveCanvas || !specCanvas) return;

    const waveCtx = waveCanvas.getContext('2d');
    const specCtx = specCanvas.getContext('2d');
    const analyser = analyserRef.current;
    if (!waveCtx || !specCtx || !analyser) return;

    const timeData = new Uint8Array(analyser.fftSize);
    const freqData = new Uint8Array(analyser.frequencyBinCount);

    const render = () => {
      analyser.getByteTimeDomainData(timeData);
      analyser.getByteFrequencyData(freqData);

      // 1. Time domain waveform
      const wWidth = waveCanvas.width;
      const wHeight = waveCanvas.height;
      waveCtx.fillStyle = '#070a12';
      waveCtx.fillRect(0, 0, wWidth, wHeight);

      // Center reference line
      waveCtx.strokeStyle = '#1e293b';
      waveCtx.lineWidth = 1;
      waveCtx.beginPath();
      waveCtx.moveTo(0, wHeight / 2);
      waveCtx.lineTo(wWidth, wHeight / 2);
      waveCtx.stroke();

      waveCtx.strokeStyle = '#10b981';
      waveCtx.lineWidth = 1.8;
      waveCtx.beginPath();
      for (let i = 0; i < timeData.length; i++) {
        const x = (i / timeData.length) * wWidth;
        const y = (timeData[i] / 255) * wHeight;
        if (i === 0) waveCtx.moveTo(x, y);
        else waveCtx.lineTo(x, y);
      }
      waveCtx.stroke();

      // 2. Frequency spectrum
      const sWidth = specCanvas.width;
      const sHeight = specCanvas.height;
      specCtx.fillStyle = '#070a12';
      specCtx.fillRect(0, 0, sWidth, sHeight);

      const barWidth = (sWidth / (freqData.length / 2)) * 1.5;
      let barX = 0;
      for (let i = 0; i < freqData.length / 2; i++) {
        const barHeight = (freqData[i] / 255) * sHeight;
        // Highlight 1200Hz and 2200Hz bins in cyan
        const isMarkSpaceBin = (i >= 20 && i <= 30) || (i >= 42 && i <= 54);
        specCtx.fillStyle = isMarkSpaceBin ? '#06b6d4' : '#1e293b';
        specCtx.fillRect(barX, sHeight - barHeight, barWidth - 1, barHeight);
        barX += barWidth;
      }

      // Mark and Space labels
      specCtx.fillStyle = '#38bdf8';
      specCtx.font = '10px monospace';
      specCtx.fillText('1200Hz(M)', sWidth * 0.22, 14);
      specCtx.fillText('2200Hz(S)', sWidth * 0.46, 14);

      // RMS meter update
      let sum = 0;
      for (let i = 0; i < timeData.length; i++) {
        const norm = (timeData[i] - 128) / 128;
        sum += norm * norm;
      }
      const rms = Math.sqrt(sum / timeData.length);
      const db = rms > 0.0001 ? Math.max(-96, 20 * Math.log10(rms)) : -96;
      setRmsDb(Math.round(db));
      setIsClipping(rms > 0.95);

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();
  }, []);

  // Streaming demodulation timer
  const startDemodWorker = useCallback(() => {
    const timer = setInterval(() => {
      const demod = demodulatorRef.current;
      const actx = audioCtxRef.current;
      if (!demod || !actx) return;

      const sps = Math.round(actx.sampleRate / baudRate);
      const available = totalSamplesRef.current - lastProcessedRef.current;
      if (available < sps * 4) return;

      const processCount = Math.min(available, 4096);
      const chunk = new Float32Array(processCount);
      const buffer = ringBufferRef.current;
      const size = buffer.length;

      for (let i = 0; i < processCount; i++) {
        const readIdx = (lastProcessedRef.current + i) % size;
        chunk[i] = buffer[readIdx];
      }
      lastProcessedRef.current += processCount;

      const packets = demod.processAudioBuffer(chunk);
      for (const pkt of packets) {
        handleNewPacket(pkt);
      }
    }, 50);

    return () => clearInterval(timer);
  }, [baudRate, handleNewPacket]);

  // Start hardware microphone / line-in capture
  const startListening = async () => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const actx = new AudioCtx();
      audioCtxRef.current = actx;

      // Essential: disable AEC, AGC, and NS to preserve raw FSK audio waveform
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      micStreamRef.current = stream;

      const source = actx.createMediaStreamSource(stream);

      // Analyser node for oscilloscope and spectrum
      const analyser = actx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;

      // ScriptProcessor for raw PCM audio streaming
      const sp = actx.createScriptProcessor(2048, 1, 1);
      source.connect(sp);

      // Mute audio output to prevent acoustic feedback loop
      const muteGain = actx.createGain();
      muteGain.gain.value = 0;
      sp.connect(muteGain);
      muteGain.connect(actx.destination);
      scriptProcessorRef.current = sp;

      sp.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const buf = ringBufferRef.current;
        const size = buf.length;
        let w = writeIdxRef.current;

        for (let i = 0; i < inputData.length; i++) {
          buf[w] = inputData[i];
          w = (w + 1) % size;
        }
        writeIdxRef.current = w;
        totalSamplesRef.current += inputData.length;
      };

      setIsListening(true);
      setStatusMessage('正在实时监听 3.5mm 耳机孔模拟音频输入...');

      // Resize canvases
      if (waveCanvasRef.current) {
        waveCanvasRef.current.width = waveCanvasRef.current.clientWidth * window.devicePixelRatio;
        waveCanvasRef.current.height = waveCanvasRef.current.clientHeight * window.devicePixelRatio;
      }
      if (specCanvasRef.current) {
        specCanvasRef.current.width = specCanvasRef.current.clientWidth * window.devicePixelRatio;
        specCanvasRef.current.height = specCanvasRef.current.clientHeight * window.devicePixelRatio;
      }

      startVisualizer();
      startDemodWorker();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`启动麦克风监听失败: ${msg}`);
    }
  };

  const stopListening = () => {
    setIsListening(false);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    setStatusMessage('已停止耳机孔音频监听');
  };

  const clearLogs = () => {
    setPackets([]);
    setValidCount(0);
    setCorruptedCount(0);
    setTotalFecCorrections(0);
  };

  const totalPackets = validCount + corruptedCount;
  const lossRate = totalPackets > 0 ? ((corruptedCount / totalPackets) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-6">
      {/* Top Banner with Standalone Links */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-950 border border-emerald-800/60 text-emerald-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">FSK 解调与接收工作台</h2>
            <p className="text-xs text-slate-400">
              通过 3.5mm 麦克风输入采集模拟音频信号，实施正交匹配滤波解调与前向纠错 (Hamming 7,4)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/receiver.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-emerald-300 border border-slate-700 transition"
          >
            <span>打开独立 receiver.html (可导出)</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Control, Signal Quality & Visualizers */}
        <div className="lg:col-span-7 space-y-5">
          {/* Hardware Audio Capture Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">硬件采集控制 (Microphone / Line-In)</h3>
              </div>
              <span className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                isListening ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-slate-950 text-slate-500 border border-slate-800'
              }`}>
                {isListening ? '● 正在捕获' : '○ 待机'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  解调目标波特率 (Baud Rate)
                </label>
                <select
                  value={baudRate}
                  onChange={(e) => setBaudRate(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value={100}>100 bps (标准强抗噪)</option>
                  <option value={150}>150 bps (均衡)</option>
                  <option value={200}>200 bps (高速)</option>
                  <option value={300}>300 bps (极速)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  纠错模式 (FEC Mode)
                </label>
                <div className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-emerald-400 flex items-center justify-between">
                  <span>Hamming(7,4) + CRC-16</span>
                  <span className="text-[10px] text-slate-500">双层防护</span>
                </div>
              </div>
            </div>

            {/* Toggle Listening Button */}
            <div className="pt-1">
              {!isListening ? (
                <button
                  type="button"
                  onClick={startListening}
                  className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold py-3 px-4 rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
                >
                  <Mic className="w-4 h-4" />
                  <span>启动 3.5mm 耳机孔音频接收监听</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopListening}
                  className="w-full bg-red-950/80 hover:bg-red-900 border border-red-700/80 text-red-300 font-bold py-3 px-4 rounded-xl text-sm flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <MicOff className="w-4 h-4" />
                  <span>停止接收监听</span>
                </button>
              )}
            </div>

            {/* Real-time Level Meter & Clipping Warning */}
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-300 flex items-center gap-1.5">
                  输入音频峰值电平:
                  {isClipping && (
                    <span className="text-red-400 font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> 削顶失真 (CLIP)! 请降低发送端音量
                    </span>
                  )}
                </span>
                <span className={`font-mono ${isClipping ? 'text-red-400 font-bold' : 'text-emerald-400'}`}>
                  {rmsDb} dBFS
                </span>
              </div>

              <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                <div
                  className={`h-full transition-all duration-75 ${
                    isClipping
                      ? 'bg-red-500'
                      : rmsDb > -12
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, (rmsDb + 60) * 1.67))}%` }}
                />
              </div>
            </div>
          </div>

          {/* Real-time Oscilloscope & Frequency Spectrum */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">时域示波器与频域能量分布</h3>
              </div>
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="text-slate-400">信噪比估算:</span>
                <span className={`font-bold px-2 py-0.5 rounded ${
                  snrDb > 15 ? 'text-emerald-400 bg-emerald-950/60' : snrDb > 8 ? 'text-amber-400 bg-amber-950/60' : 'text-slate-400 bg-slate-950'
                }`}>
                  {snrDb > 0 ? `${snrDb} dB` : '-- dB'}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>接收端时域波形 (Time Domain Oscilloscope)</span>
                  <span className="font-mono text-emerald-400">采样周期自适应</span>
                </div>
                <div className="rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
                  <canvas ref={waveCanvasRef} className="w-full h-28 block" />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>频域能量 FFT 频谱 (Mark 1200Hz / Space 2200Hz)</span>
                  <span className="font-mono text-cyan-400">正交解调匹配</span>
                </div>
                <div className="rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
                  <canvas ref={specCanvasRef} className="w-full h-24 block" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Statistics & Message Log */}
        <div className="lg:col-span-5 space-y-5">
          {/* Loss & Reliability Stats */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-semibold text-white border-b border-slate-800 pb-2">
              传输质量与丢包统计 (Packet Loss & FEC)
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3">
                <div className="text-[11px] text-slate-500">有效接收帧数 (CRC Pass)</div>
                <div className="text-lg font-mono font-bold text-emerald-400 mt-1 flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span>{validCount}</span>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3">
                <div className="text-[11px] text-slate-500">前向纠错纠偏次数 (FEC)</div>
                <div className="text-lg font-mono font-bold text-cyan-400 mt-1 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  <span>{totalFecCorrections}</span>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3">
                <div className="text-[11px] text-slate-500">CRC 校验失败帧数</div>
                <div className="text-lg font-mono font-bold text-red-400 mt-1 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span>{corruptedCount}</span>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3">
                <div className="text-[11px] text-slate-500">实时丢包率 (Packet Loss)</div>
                <div className={`text-lg font-mono font-bold mt-1 ${Number(lossRate) > 10 ? 'text-red-400' : 'text-slate-200'}`}>
                  {lossRate}%
                </div>
              </div>
            </div>

            <div className="text-[11px] text-slate-400 leading-relaxed bg-slate-950/60 p-3 rounded-lg border border-slate-800">
              <b>纠错机制说明：</b> 采用 Hamming(7,4) 线性分组前向纠错码。每个数据半字节编码为 7 位码字，接收端通过校验伴随式 (Syndrome S) 能够准确定位并自动纠正任意 1 位错码；若多位错码超出纠错范围，则由 CRC-16 校验码拦截并记录为丢包。
            </div>
          </div>

          {/* Real-time Decoded Message Log */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-sm font-semibold text-white">接收解码明文流 (Message Stream)</h3>
              <button
                type="button"
                onClick={clearLogs}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>清空记录</span>
              </button>
            </div>

            <div className="h-64 overflow-y-auto space-y-2.5 pr-1 font-mono text-xs">
              {packets.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center px-4">
                  <Activity className="w-8 h-8 text-slate-700 mb-2" />
                  <p>尚无接收到的数据包</p>
                  <p className="text-[11px] mt-1">连接 3.5mm 对录线并启动监听，发送端发出数据后将在此实时显示</p>
                </div>
              ) : (
                packets.map((pkt, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border transition ${
                      pkt.crcValid
                        ? 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                        : 'bg-red-950/20 border-red-900/60'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5 pb-1 border-b border-slate-900">
                      <span className="font-semibold text-slate-300">
                        帧序号 #{pkt.seq} · {new Date(pkt.timestamp).toLocaleTimeString()}
                      </span>
                      <div className="flex items-center gap-2">
                        {pkt.fecCorrections > 0 && (
                          <span className="text-cyan-400 bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-800/80">
                            FEC已纠偏 {pkt.fecCorrections} 位
                          </span>
                        )}
                        <span className={pkt.crcValid ? 'text-emerald-400' : 'text-red-400'}>
                          {pkt.crcValid ? '✓ CRC-16 正确' : '✗ CRC 校验错误'}
                        </span>
                      </div>
                    </div>

                    <div className="text-white text-xs bg-slate-900/80 p-2 rounded border border-slate-800/60 break-all select-all font-sans">
                      {pkt.text || `[${pkt.payload.length} 字节二进制数据]`}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1.5">
                      <span>有效负载: {pkt.payload.length} 字节</span>
                      <span>CRC: 0x{pkt.crcReceived.toString(16).padStart(4, '0').toUpperCase()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function ShieldCheck(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}
