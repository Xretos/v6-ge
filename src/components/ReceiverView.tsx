/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Activity,
  ExternalLink,
  CheckCircle,
  AlertTriangle,
  Trash2,
  BarChart2,
  Download,
  FileCheck,
  FileText,
  FileUp,
  Package,
  Eye,
  EyeOff,
  Zap,
  Copy,
  Check,
  RotateCcw
} from 'lucide-react';
import {
  FSKDemodulator,
  DecodedPacket,
  FileAssembler,
  AssembledFile,
  FileProgress,
  ActiveTransferInfo,
  PacketType,
  SPEED_PRESETS
} from '../dsp/fsk';

interface ReceiverViewProps {
  sampleRate: number;
  syntheticAudioFeed?: Float32Array | null;
}

export const ReceiverView: React.FC<ReceiverViewProps> = ({ sampleRate, syntheticAudioFeed }) => {
  const [isListening, setIsListening] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('100');
  const [baudRate, setBaudRate] = useState<number>(100);
  const [markFreq, setMarkFreq] = useState<number>(1200);
  const [spaceFreq, setSpaceFreq] = useState<number>(2200);
  const [snrDb, setSnrDb] = useState<number>(0);
  const [rmsDb, setRmsDb] = useState<number>(-96);
  const [isClipping, setIsClipping] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('等待启动耳机孔输入监听...');

  const applySpeedPreset = (presetId: string) => {
    const preset = SPEED_PRESETS[presetId];
    if (!preset) return;
    setSelectedPresetId(presetId);
    setBaudRate(preset.baudRate);
    setMarkFreq(preset.markFreq);
    setSpaceFreq(preset.spaceFreq);
    if (demodulatorRef.current) {
      demodulatorRef.current.updateConfig({
        baudRate: preset.baudRate,
        markFreq: preset.markFreq,
        spaceFreq: preset.spaceFreq,
        modulationScheme: preset.modulationScheme,
        frequencies: preset.frequencies,
      });
    }
    setStatusMessage(`已切换解调模式: ${preset.name} (${preset.speedMultiplier}x 加速)`);
  };

  // Packet & Loss Stats
  const [packets, setPackets] = useState<DecodedPacket[]>([]);
  const [validCount, setValidCount] = useState<number>(0);
  const [corruptedCount, setCorruptedCount] = useState<number>(0);
  const [totalFecCorrections, setTotalFecCorrections] = useState<number>(0);

  // File Transfer State
  const [activeFileProgress, setActiveFileProgress] = useState<FileProgress | null>(null);
  const [activeTransferInfo, setActiveTransferInfo] = useState<ActiveTransferInfo | null>(null);
  const [copiedToast, setCopiedToast] = useState(false);
  const [receivedFiles, setReceivedFiles] = useState<AssembledFile[]>([]);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);

  // Audio nodes & Canvas refs
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);
  const specCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const demodulatorRef = useRef<FSKDemodulator | null>(null);
  const fileAssemblerRef = useRef<FileAssembler | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const activeTonesRef = useRef<number[]>([1200, 2200]);

  // Keep active tones ref updated with selected preset
  useEffect(() => {
    const preset = SPEED_PRESETS[selectedPresetId];
    if (preset?.frequencies && preset.frequencies.length > 0) {
      activeTonesRef.current = [...preset.frequencies];
    } else {
      activeTonesRef.current = [preset?.spaceFreq || 2200, preset?.markFreq || 1200];
    }
  }, [selectedPresetId]);

  // Initialize demodulator and file assembler
  useEffect(() => {
    const preset = SPEED_PRESETS[selectedPresetId];
    const modulationScheme = preset?.modulationScheme || '2FSK';
    const frequencies = preset?.frequencies;

    if (frequencies && frequencies.length > 0) {
      activeTonesRef.current = [...frequencies];
    } else {
      activeTonesRef.current = [preset?.spaceFreq || 2200, preset?.markFreq || 1200];
    }

    const demod = new FSKDemodulator({
      sampleRate,
      baudRate,
      markFreq,
      spaceFreq,
      modulationScheme,
      frequencies,
      useFEC: true,
    });

    demod.setOnSignalQuality((quality) => {
      setSnrDb(Math.round(quality.snrDb));
      const db = quality.rms > 0.0001 ? Math.max(-96, 20 * Math.log10(quality.rms)) : -96;
      setRmsDb(Math.round(db));
      setIsClipping(quality.rms > 0.95);
    });

    demodulatorRef.current = demod;

    // File assembler
    const assembler = new FileAssembler();
    const existing = assembler.getActiveTransfer();
    if (existing && existing.receivedChunks > 0) {
      setActiveTransferInfo(existing);
    }

    assembler.onProgress = (prog) => {
      setActiveFileProgress({ ...prog });
      setActiveTransferInfo(assembler.getActiveTransfer());
      setStatusMessage(`正在接收文件 [${prog.name}]: 分卷 ${prog.receivedChunks}/${prog.totalChunks} (${prog.percent}%)`);
    };

    assembler.onComplete = (file) => {
      setReceivedFiles((prev) => [file, ...prev.filter((f) => f.name !== file.name)]);
      setActiveFileProgress(null);
      setActiveTransferInfo(null);
      setStatusMessage(`✓ 文件 [${file.name}] 已成功重组接收完毕 (${file.size} 字节，CRC-16 校验 ${file.crcValid ? '通过' : '失败'})`);
    };

    fileAssemblerRef.current = assembler;
  }, [sampleRate, baudRate, markFreq, spaceFreq, selectedPresetId]);

  const handleCopyMissingChunks = () => {
    if (!fileAssemblerRef.current) return;
    const missing = fileAssemblerRef.current.getMissingChunkNumbers1Based();
    if (missing.length === 0) return;
    const str = missing.join(', ');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(str);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 3000);
    }
  };

  const handleClearBreakpoint = () => {
    if (fileAssemblerRef.current) {
      fileAssemblerRef.current.clearStorage();
      setActiveTransferInfo(null);
      setActiveFileProgress(null);
      setStatusMessage('已清空断点续传文件缓存');
    }
  };

  const handleManualAssemble = () => {
    if (!fileAssemblerRef.current) return;
    const assembled = fileAssemblerRef.current.finalizeFile();
    if (assembled) {
      setReceivedFiles((prev) => [assembled, ...prev.filter((f) => f.name !== assembled.name)]);
      setActiveFileProgress(null);
      setActiveTransferInfo(null);
      setStatusMessage(`✓ 文件 [${assembled.name}] 已手动合并重组成功 (${assembled.size} 字节)`);
    }
  };

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

    // Feed to File Assembler
    if (fileAssemblerRef.current && pkt.crcValid) {
      const assembled = fileAssemblerRef.current.processPacket(pkt);
      if (assembled) {
        setReceivedFiles((prev) => [assembled, ...prev.filter((f) => f.name !== assembled.name)]);
        setActiveFileProgress(null);
        setActiveTransferInfo(null);
        setStatusMessage(`✓ 文件 [${assembled.name}] 接收完成并成功合并重组 (${assembled.size} 字节，CRC-16 校验通过)`);
      } else {
        setActiveTransferInfo(fileAssemblerRef.current.getActiveTransfer());
      }
    }
  }, []);

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
  }, [syntheticAudioFeed, handleNewPacket]);

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

    const PALETTE = [
      '#06b6d4', // Cyan (f0)
      '#10b981', // Emerald (f1)
      '#f59e0b', // Amber (f2)
      '#c084fc', // Purple (f3)
      '#f43f5e', // Rose (f4)
      '#38bdf8', // Sky (f5)
      '#a3e635', // Lime (f6)
      '#fb923c', // Orange (f7)
    ];

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

      // 2. Dynamic Frequency Spectrum for active M-FSK tones
      const sWidth = specCanvas.width;
      const sHeight = specCanvas.height;
      specCtx.fillStyle = '#070a12';
      specCtx.fillRect(0, 0, sWidth, sHeight);

      const currentFs = audioCtxRef.current?.sampleRate || sampleRate || 48000;
      const binHz = currentFs / 1024;
      const tones = activeTonesRef.current && activeTonesRef.current.length > 0
        ? activeTonesRef.current
        : [1200, 2200];
      const toneBins = tones.map((f) => Math.round(f / binHz));

      const totalBins = Math.floor(freqData.length / 2);
      const barWidth = (sWidth / totalBins) * 1.5;
      let barX = 0;
      for (let i = 0; i < totalBins; i++) {
        const barHeight = (freqData[i] / 255) * sHeight;
        
        let matchedToneIdx = -1;
        for (let t = 0; t < toneBins.length; t++) {
          if (Math.abs(i - toneBins[t]) <= 2) {
            matchedToneIdx = t;
            break;
          }
        }

        specCtx.fillStyle = matchedToneIdx !== -1 ? PALETTE[matchedToneIdx % PALETTE.length] : '#1e293b';
        specCtx.fillRect(barX, sHeight - barHeight, barWidth - 1, barHeight);
        barX += barWidth;
      }

      // Dynamic Tone markers above peaks
      specCtx.font = '9px monospace';
      for (let t = 0; t < tones.length; t++) {
        const toneFreq = tones[t];
        const toneBin = toneBins[t];
        const color = PALETTE[t % PALETTE.length];
        const toneX = Math.min(sWidth - 55, Math.max(3, (toneBin / totalBins) * sWidth - 18));
        const toneY = 12 + (t % 2) * 11;
        specCtx.fillStyle = color;
        specCtx.fillText(`f${t}:${toneFreq}`, toneX, toneY);
      }

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

  // Start hardware microphone / line-in capture
  const startListening = async () => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const actx = new AudioCtx();
      audioCtxRef.current = actx;

      // Disable AEC, AGC, and NS to preserve raw FSK audio waveform
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
        if (demodulatorRef.current) {
          const pkts = demodulatorRef.current.processAudioBuffer(inputData);
          for (const pkt of pkts) {
            handleNewPacket(pkt);
          }
        }
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
            <h2 className="text-sm font-semibold text-white">FSK 解调与数据/文件接收工作台</h2>
            <p className="text-xs text-slate-400">
              通过 3.5mm 麦克风输入采集模拟音频信号，实施正交匹配滤波解调、Hamming(7,4) 纠错与多包文件重组
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

            {/* Speed Presets */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-emerald-400" />
                  <span>匹配发送端速率预设 (Speed Presets):</span>
                </span>
                <span className="text-[11px] text-emerald-400 font-mono">
                  当前: {SPEED_PRESETS[selectedPresetId]?.speedMultiplier || 1}x 速
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Array.from(new Set(Object.values(SPEED_PRESETS))).map((p) => {
                  const isActive = selectedPresetId === p.id;
                  const is4FSK = p.modulationScheme === '4FSK';
                  const is8FSK = p.modulationScheme === '8FSK';
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={isListening}
                      onClick={() => applySpeedPreset(p.id)}
                      className={`p-2.5 rounded-lg border text-left transition cursor-pointer disabled:opacity-50 ${
                        isActive
                          ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 shadow-sm shadow-emerald-500/20'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white flex items-center gap-1">
                          {p.bitRate} bps
                          {is4FSK && (
                            <span className="text-[9px] px-1 bg-cyan-950 text-cyan-300 border border-cyan-800 rounded font-normal">
                              4-FSK
                            </span>
                          )}
                          {is8FSK && (
                            <span className="text-[9px] px-1 bg-purple-950 text-purple-300 border border-purple-800 rounded font-normal">
                              8-FSK
                            </span>
                          )}
                        </span>
                        <span className={`text-[10px] font-mono px-1 rounded ${
                          p.speedMultiplier >= 30
                            ? 'bg-purple-950 text-purple-300 border border-purple-800'
                            : p.speedMultiplier >= 20
                            ? 'bg-amber-950 text-amber-400 border border-amber-800'
                            : 'bg-slate-900 text-slate-400'
                        }`}>
                          {p.speedMultiplier}x
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate mt-1">
                        {p.id === '3000_8fsk'
                          ? '🚀 8-FSK 3000bps'
                          : p.id === '4500_8fsk'
                          ? '💎 8-FSK 4500bps (首选)'
                          : p.id === '6000_8fsk'
                          ? '⚡ 8-FSK 6000bps (整频)'
                          : p.id === '7200_8fsk'
                          ? '🔥 8-FSK 7200bps (极速)'
                          : p.id === '2000_4fsk'
                          ? '⚡ 4-FSK 推荐 0丢包'
                          : p.id === '4000'
                          ? '🔥 4000bps 极速'
                          : p.id === '1000'
                          ? '10倍极速 Turbo'
                          : p.id === '2000_2fsk'
                          ? '20倍 2-FSK超频'
                          : p.id === '500'
                          ? '5倍平稳'
                          : '1x 标准抗噪'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  解调目标波特率 (Baud Rate)
                </label>
                <select
                  value={baudRate}
                  onChange={(e) => {
                    const b = Number(e.target.value);
                    setBaudRate(b);
                    if (b === 1000) { setMarkFreq(2000); setSpaceFreq(3000); }
                    else if (b === 2000) { setMarkFreq(2000); setSpaceFreq(4000); }
                    else if (b === 500) { setMarkFreq(1500); setSpaceFreq(2500); }
                    else if (b === 100) { setMarkFreq(1200); setSpaceFreq(2200); }
                  }}
                  disabled={isListening}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                >
                  <option value={100}>100 bps (标准强抗噪，Mark 1200 / Space 2200)</option>
                  <option value={200}>200 bps (2倍速轻度加速)</option>
                  <option value={500}>500 bps (5倍速平稳加速，Mark 1500 / Space 2500)</option>
                  <option value={1000}>1000 bps (⚡ 10倍速 Turbo 极速，Mark 2000 / Space 3000)</option>
                  <option value={2000}>2000 bps (🔥 20倍速 Extreme 超频，Mark 2000 / Space 4000)</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">必须与发送端波特率与频点保持一致</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  纠错与文件重组机制
                </label>
                <div className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-emerald-400 flex items-center justify-between">
                  <span>Hamming(7,4) + CRC-16</span>
                  <span className="text-[10px] text-cyan-400">支持文件自动重组</span>
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

          {/* ACTIVE INCOMING FILE PROGRESS CARD */}
          {activeFileProgress && (
            <div className="bg-cyan-950/40 border border-cyan-800/80 rounded-xl p-4 shadow-md space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-cyan-300">
                  <Package className="w-4 h-4 animate-bounce" />
                  <span className="text-xs font-semibold">正在接收并拼接文件: {activeFileProgress.name}</span>
                </div>
                <span className="text-xs font-mono text-cyan-300 font-bold">
                  {activeFileProgress.receivedChunks} / {activeFileProgress.totalChunks} 分卷 ({activeFileProgress.percent}%)
                </span>
              </div>

              <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden border border-cyan-900/60">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-150"
                  style={{ width: `${activeFileProgress.percent}%` }}
                />
              </div>

              <div className="flex justify-between items-center text-[11px] text-slate-400 font-mono">
                <span>已接收载荷: {activeFileProgress.receivedBytes} / {activeFileProgress.totalBytes} 字节</span>
                <span className="text-cyan-400">正在等待后续分卷音频...</span>
              </div>
            </div>
          )}

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
                  <span className="font-mono text-emerald-400">连续相位采样自适应</span>
                </div>
                <div className="rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
                  <canvas ref={waveCanvasRef} className="w-full h-28 block" />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center text-[11px] text-slate-400 mb-1">
                  <span className="text-white font-medium">
                    频域 FFT 能量分布 ({SPEED_PRESETS[selectedPresetId]?.modulationScheme || '2FSK'} · {
                      (SPEED_PRESETS[selectedPresetId]?.frequencies || [SPEED_PRESETS[selectedPresetId]?.spaceFreq, SPEED_PRESETS[selectedPresetId]?.markFreq]).join('/')
                    } Hz)
                  </span>
                  <span className="font-mono text-cyan-400">正交解调匹配</span>
                </div>
                <div className="rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
                  <canvas ref={specCanvasRef} className="w-full h-24 block" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Statistics, Received Files & Message Log */}
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
                  <FileCheck className="w-4 h-4 text-cyan-400" />
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
          </div>

          {/* ACTIVE FILE TRANSFER & BREAKPOINT ARQ CARD */}
          {activeTransferInfo && (
            <div className="bg-slate-900/90 border border-cyan-800/60 rounded-xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-white">断点续传与分卷进度</h3>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                  {activeTransferInfo.receivedChunks}/{activeTransferInfo.totalChunks} 分卷
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-white font-medium truncate">{activeTransferInfo.name}</span>
                  <span className="font-mono text-cyan-400 font-bold">{activeTransferInfo.percent}%</span>
                </div>

                <div className="h-2.5 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-200"
                    style={{ width: `${activeTransferInfo.percent}%` }}
                  />
                </div>

                {activeTransferInfo.missingChunksCount > 0 ? (
                  <div className="p-3 bg-slate-950 rounded-lg border border-amber-900/50 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-amber-400 font-semibold flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>检测到 {activeTransferInfo.missingChunksCount} 个缺失/校验失败分卷</span>
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyMissingChunks}
                        className="flex items-center gap-1 px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded text-xs font-medium transition cursor-pointer"
                      >
                        {copiedToast ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedToast ? '已复制！' : '一键复制缺失序号'}</span>
                      </button>
                    </div>

                    <div className="p-2 bg-slate-900 rounded font-mono text-[11px] text-slate-300 max-h-20 overflow-y-auto break-all select-all">
                      {activeTransferInfo.missingChunksFormatted}
                    </div>

                    <p className="text-[11px] text-slate-400">
                      👉 点击「一键复制缺失序号」后，在发送端的「批量输入包序号 · 选择性重传」中粘贴发送，即可瞬间补齐！
                    </p>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-emerald-950/80 border border-emerald-600/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                        🎉 全部分卷已齐备 ({activeTransferInfo.receivedChunks}/{activeTransferInfo.totalChunks})！
                      </span>
                      <button
                        type="button"
                        onClick={handleManualAssemble}
                        className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded text-xs transition cursor-pointer shadow flex items-center gap-1"
                      >
                        <FileCheck className="w-3.5 h-3.5" />
                        <span>立即合并重组文件</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-emerald-400/80">
                      所有分卷数据完整无缺，点击上方按钮即可立即生成完整文件供下载与预览。
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-slate-500">
                    💾 进度已自动持久化存储 (LocalStorage)，页面刷新不丢失
                  </span>
                  <button
                    type="button"
                    onClick={handleClearBreakpoint}
                    className="text-[11px] text-slate-400 hover:text-red-400 transition cursor-pointer flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>清除断点缓存</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* COMPLETED RECEIVED FILES DRAWER */}
          {receivedFiles.length > 0 && (
            <div className="bg-slate-900/80 border border-emerald-800/60 rounded-xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">已成功重组接收的文件 ({receivedFiles.length})</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setReceivedFiles([])}
                  className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  清空文件
                </button>
              </div>

              <div className="space-y-3">
                {receivedFiles.map((file, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-slate-950 rounded-lg border border-slate-800 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-cyan-400" />
                          <span>{file.name}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          {file.size} 字节 · {file.receivedChunks}/{file.totalChunks} 分卷 · {new Date(file.timestamp).toLocaleTimeString()}
                        </div>
                      </div>

                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                        file.crcValid
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                          : 'bg-red-950 text-red-300 border-red-800'
                      }`}>
                        {file.crcValid ? '✓ 全文件 CRC 匹配' : '✗ CRC 不匹配'}
                      </span>
                    </div>

                    {/* Preview Area */}
                    {previewIdx === idx && file.textPreview && (
                      <div className="p-2.5 bg-slate-900 rounded border border-slate-800 font-mono text-[11px] text-slate-300 max-h-36 overflow-y-auto whitespace-pre-wrap break-all">
                        {file.textPreview}
                      </div>
                    )}

                    {/* Actions: Download and Preview */}
                    <div className="flex items-center gap-2 pt-1 border-t border-slate-900">
                      {file.blobUrl && (
                        <a
                          href={file.blobUrl}
                          download={file.name}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded text-xs transition cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>下载到手机本地</span>
                        </a>
                      )}

                      {file.textPreview && (
                        <button
                          type="button"
                          onClick={() => setPreviewIdx(previewIdx === idx ? null : idx)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs border border-slate-700 transition cursor-pointer"
                        >
                          {previewIdx === idx ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          <span>{previewIdx === idx ? '收起预览' : '直接预览'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                        {pkt.packetType !== PacketType.TEXT && (
                          <span className="text-cyan-300 bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-800/80">
                            {pkt.packetType === PacketType.FILE_START
                              ? 'FILE_START'
                              : pkt.packetType === PacketType.FILE_DATA
                              ? 'FILE_DATA'
                              : 'FILE_END'}
                          </span>
                        )}
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
                      {pkt.packetType === PacketType.FILE_DATA && pkt.fileMeta?.chunkIdx !== undefined
                        ? `[文件分卷 #${pkt.fileMeta.chunkIdx + 1} / ${pkt.fileMeta.totalChunks} · ${pkt.fileMeta.chunkData?.length || 0} 字节]`
                        : pkt.text || `[${pkt.payload.length} 字节二进制数据]`}
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
