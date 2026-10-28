/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Volume2,
  Send,
  Square,
  ExternalLink,
  Sliders,
  Waves,
  ShieldCheck,
  FileText,
  Upload,
  FileCode,
  FileUp,
  CheckCircle2,
  Pause,
  Play,
  RotateCcw
} from 'lucide-react';
import { FrameEncoder, FSKModulator, FileChunker, PacketType, DEFAULT_CONFIG, ModemConfig } from '../dsp/fsk';

interface TransmitterViewProps {
  sampleRate: number;
  onAudioBufferGenerated?: (buffer: Float32Array, text: string) => void;
}

interface SelectedFile {
  name: string;
  size: number;
  mime: string;
  data: Uint8Array;
}

export const TransmitterView: React.FC<TransmitterViewProps> = ({ sampleRate, onAudioBufferGenerated }) => {
  // Mode selection: 'text' or 'file'
  const [activeTab, setActiveTab] = useState<'text' | 'file'>('text');

  // Text message state
  const [message, setMessage] = useState('Hello Android via 3.5mm AudioJack!');

  // File transmission state
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [chunkSize, setChunkSize] = useState<number>(48);
  const [fileProgress, setFileProgress] = useState<{
    currentChunk: number;
    totalChunks: number;
    percent: number;
    currentPacketDesc: string;
  } | null>(null);
  const isCancelledRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const [isPaused, setIsPaused] = useState(false);

  // Modulation config
  const [baudRate, setBaudRate] = useState<number>(100);
  const [useFEC, setUseFEC] = useState<boolean>(true);
  const [markFreq, setMarkFreq] = useState<number>(1200);
  const [spaceFreq, setSpaceFreq] = useState<number>(2200);
  const [volume, setVolume] = useState<number>(75);

  const [isTransmitting, setIsTransmitting] = useState(false);
  const [activeTone, setActiveTone] = useState<number | null>(null);
  const [statusText, setStatusText] = useState('待机空闲 (准备就绪)');
  const [packetSeq, setPacketSeq] = useState(1);
  const [sentPackets, setSentPackets] = useState(0);
  const [sentBytes, setSentBytes] = useState(0);
  const [frameDuration, setFrameDuration] = useState('0.00s');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const toneOscRef = useRef<OscillatorNode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const textPresets = [
    { label: 'Ping 握手包', text: 'PING-001-ACK' },
    { label: 'GPS 坐标', text: 'GPS: 39.9042, 116.4074' },
    { label: '气象传感器', text: 'TEMPER: 24.5C, HUMI: 60%RH' },
    { label: '紧急求救电报', text: 'SOS EMERGENCY LAT:31.23 LON:121.47' },
  ];

  // Draw waveform
  const drawWaveform = (samples: Float32Array | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#070a12';
    ctx.fillRect(0, 0, width, height);

    // Grid center line
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    if (!samples || samples.length === 0) {
      ctx.fillStyle = '#475569';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('准备发送音频数据，示波器将显示 CPFSK 调制波形', width / 2, height / 2 - 8);
      return;
    }

    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const step = Math.max(1, Math.floor(samples.length / width));
    for (let x = 0; x < width; x++) {
      const idx = x * step;
      const val = samples[idx] || 0;
      const y = (0.5 - val * 0.45) * height;
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
      drawWaveform(null);
    }
  }, []);

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  // Tone generation for hardware calibration
  const toggleTone = (freq: number) => {
    const ctx = getAudioContext();
    if (activeTone === freq && toneOscRef.current) {
      toneOscRef.current.stop();
      toneOscRef.current.disconnect();
      toneOscRef.current = null;
      setActiveTone(null);
      setStatusText('校准音已停止');
      drawWaveform(null);
      return;
    }

    if (toneOscRef.current) {
      toneOscRef.current.stop();
      toneOscRef.current.disconnect();
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = (volume / 100) * 0.6;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    toneOscRef.current = osc;
    setActiveTone(freq);
    setStatusText(`正在输出 ${freq} Hz 连续校准音频信号 (用于调节线损与电平)...`);
  };

  // --- TEXT TRANSMISSION ---
  const handleSendText = () => {
    const trimmed = message.trim();
    if (!trimmed) return;

    const ctx = getAudioContext();
    const actualSampleRate = ctx.sampleRate;

    const config: ModemConfig = {
      sampleRate: actualSampleRate,
      baudRate,
      markFreq,
      spaceFreq,
      amplitude: volume / 100,
      useFEC,
    };

    // 1. Frame encoding with Hamming(7,4) and CRC-16
    const payload = new TextEncoder().encode(trimmed);
    const bits = FrameEncoder.encodePacketToBits(payload, packetSeq, useFEC, PacketType.TEXT);

    // 2. Modulate to CPFSK
    const samples = FSKModulator.modulate(bits, config);
    drawWaveform(samples);

    if (onAudioBufferGenerated) {
      onAudioBufferGenerated(samples, trimmed);
    }

    // 3. Play via Web Audio
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch {}
    }

    const buffer = ctx.createBuffer(1, samples.length, actualSampleRate);
    buffer.getChannelData(0).set(samples);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const dur = (samples.length / actualSampleRate).toFixed(2);
    setFrameDuration(`${bits.length} bits / ${dur}s`);
    setIsTransmitting(true);
    setStatusText(`正在向 3.5mm 耳机孔输出音频文本报文 [Seq #${packetSeq}]...`);

    source.onended = () => {
      setIsTransmitting(false);
      setStatusText(`✓ 报文 [Seq #${packetSeq}] 已完成发送`);
      setSentPackets((prev) => prev + 1);
      setSentBytes((prev) => prev + payload.length);
      setPacketSeq((prev) => prev + 1);
    };

    source.start();
    currentSourceRef.current = source;
  };

  // --- FILE HANDLING ---
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadLocalFile(file);
  };

  const loadLocalFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuf = reader.result as ArrayBuffer;
      setSelectedFile({
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        data: new Uint8Array(arrayBuf),
      });
      setFileProgress(null);
      setStatusText(`已载入文件: ${file.name} (${file.size} 字节)`);
    };
    reader.readAsArrayBuffer(file);
  };

  const loadSampleFile = (type: 'json' | 'csv' | 'text') => {
    let name = 'config.json';
    let content = '{\n  "device": "Android-3.5mm",\n  "status": "online",\n  "baud": 100,\n  "fec": true\n}';
    let mime = 'application/json';

    if (type === 'csv') {
      name = 'sensors.csv';
      content = 'timestamp,temp_c,humidity,pressure\n1700000000,24.5,58,1013\n1700000010,24.6,57,1013';
      mime = 'text/csv';
    } else if (type === 'text') {
      name = 'note.txt';
      content = 'AudioJack 3.5mm Modem: 模拟音频口低功耗单向通信验证。\n支持任意 Android 手机耳机孔直接传输！';
      mime = 'text/plain';
    }

    const data = new TextEncoder().encode(content);
    setSelectedFile({
      name,
      size: data.length,
      mime,
      data,
    });
    setFileProgress(null);
    setStatusText(`已载入预设示例文件: ${name} (${data.length} 字节)`);
  };

  // --- FILE TRANSMISSION LOOP ---
  const handleSendFile = async () => {
    if (!selectedFile || selectedFile.data.length === 0) return;

    const ctx = getAudioContext();
    const actualSampleRate = ctx.sampleRate;
    const config: ModemConfig = {
      sampleRate: actualSampleRate,
      baudRate,
      markFreq,
      spaceFreq,
      amplitude: volume / 100,
      useFEC,
    };

    // 1. Chunk file into packets
    const packets = FileChunker.createFilePackets(
      selectedFile.name,
      selectedFile.data,
      selectedFile.mime,
      chunkSize,
      useFEC,
      packetSeq
    );

    isCancelledRef.current = false;
    isPausedRef.current = false;
    setIsPaused(false);
    setIsTransmitting(true);

    setStatusText(`开始通过音频传输文件: ${selectedFile.name} (共 ${packets.length} 帧)...`);

    let sentPktCounter = 0;
    let sentByteCounter = 0;

    for (let i = 0; i < packets.length; i++) {
      if (isCancelledRef.current) {
        setStatusText('文件传输已被用户手动取消');
        break;
      }

      // Handle pause loop
      while (isPausedRef.current) {
        await new Promise((r) => setTimeout(r, 200));
        if (isCancelledRef.current) break;
      }
      if (isCancelledRef.current) break;

      const pkt = packets[i];
      const percent = Math.round(((i + 1) / packets.length) * 100);
      setFileProgress({
        currentChunk: i + 1,
        totalChunks: packets.length,
        percent,
        currentPacketDesc: pkt.description,
      });

      // Modulate packet bits
      const samples = FSKModulator.modulate(pkt.bits, config);
      drawWaveform(samples);

      const durSec = (samples.length / actualSampleRate).toFixed(2);
      setFrameDuration(`[${i + 1}/${packets.length}] ${pkt.bits.length}b / ${durSec}s`);
      setStatusText(`正在发送: ${pkt.description}`);

      // Play audio chunk
      const buffer = ctx.createBuffer(1, samples.length, actualSampleRate);
      buffer.getChannelData(0).set(samples);

      await new Promise<void>((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        currentSourceRef.current = source;

        source.onended = () => {
          resolve();
        };

        source.start();
      });

      sentPktCounter++;
      sentByteCounter += pkt.payload.length;
      setSentPackets((prev) => prev + 1);
      setSentBytes((prev) => prev + pkt.payload.length);
      setPacketSeq((prev) => prev + 1);

      // Guard silence interval between chunks (80ms) to allow receiver AGC to stabilize
      if (i < packets.length - 1 && !isCancelledRef.current) {
        await new Promise((r) => setTimeout(r, 80));
      }
    }

    setIsTransmitting(false);
    if (!isCancelledRef.current) {
      setStatusText(`✓ 文件 ${selectedFile.name} 全部分卷已成功发射完毕！`);
      setFileProgress((prev) => (prev ? { ...prev, percent: 100 } : null));
    }
  };

  const handlePauseResume = () => {
    isPausedRef.current = !isPausedRef.current;
    setIsPaused(isPausedRef.current);
    if (isPausedRef.current) {
      setStatusText('传输已暂停');
    } else {
      setStatusText('传输已恢复继续...');
    }
  };

  const handleStop = () => {
    isCancelledRef.current = true;
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch {}
      currentSourceRef.current = null;
    }
    if (toneOscRef.current) {
      try { toneOscRef.current.stop(); } catch {}
      toneOscRef.current = null;
    }
    setIsTransmitting(false);
    setIsPaused(false);
    setActiveTone(null);
    setStatusText('已中断传输');
  };

  // Estimate transmission duration for selected file
  const estimateFileDuration = () => {
    if (!selectedFile) return '0s';
    const totalChunks = Math.max(1, Math.ceil(selectedFile.data.length / chunkSize));
    // Packets: 1 start + totalChunks + 1 end
    const totalPacketsCount = totalChunks + 2;
    // Each packet has ~48 preamble+sync, ~42 header FEC, payload bits * 1.75, ~42 CRC FEC
    const avgPacketBits = 48 + 42 + (chunkSize * 14) + 42;
    const totalSeconds = (totalPacketsCount * avgPacketBits) / baudRate + totalPacketsCount * 0.1;
    if (totalSeconds < 60) {
      return `约 ${Math.ceil(totalSeconds)} 秒`;
    }
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.ceil(totalSeconds % 60);
    return `约 ${mins} 分 ${secs} 秒`;
  };

  return (
    <div className="space-y-6">
      {/* Top Banner with Standalone Links */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-950 border border-cyan-800/60 text-cyan-400">
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">FSK 编码数据/文件发送工作台</h2>
            <p className="text-xs text-slate-400">
              通过 3.5mm 耳机孔向对录线输出 Continuous-Phase FSK 调频音频模拟信号
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/sender.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-cyan-300 border border-slate-700 transition"
          >
            <span>打开独立 sender.html (可导出)</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Config & Input */}
        <div className="lg:col-span-7 space-y-5">
          {/* Channel & Modulation Config */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-white">调制参数配置 (Modulation)</h3>
              </div>
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded">
                连续相位 CPFSK
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  通信波特率 (Baud Rate)
                </label>
                <select
                  value={baudRate}
                  onChange={(e) => setBaudRate(Number(e.target.value))}
                  disabled={isTransmitting}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 disabled:opacity-60"
                >
                  <option value={100}>100 bps (超强抗噪，推荐标准)</option>
                  <option value={150}>150 bps (均衡模式)</option>
                  <option value={200}>200 bps (高速传输)</option>
                  <option value={300}>300 bps (极速近距)</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">满足“传输速率至少达到每秒100比特”标准</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  前向纠错机制 (FEC)
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isTransmitting}
                    onClick={() => setUseFEC(!useFEC)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition cursor-pointer disabled:opacity-60 ${
                      useFEC
                        ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/80 shadow-sm'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>{useFEC ? '使能 Hamming(7,4)' : '无 FEC (原始直通)'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">自动识别并纠正任意单比特传输错码</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-300">Mark 频点 (位 1):</span>
                  <span className="font-mono text-cyan-400">{markFreq} Hz</span>
                </div>
                <input
                  type="range"
                  min="800"
                  max="2400"
                  step="50"
                  value={markFreq}
                  disabled={isTransmitting}
                  onChange={(e) => setMarkFreq(Number(e.target.value))}
                  className="w-full accent-cyan-500 cursor-pointer disabled:opacity-60"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-300">Space 频点 (位 0):</span>
                  <span className="font-mono text-cyan-400">{spaceFreq} Hz</span>
                </div>
                <input
                  type="range"
                  min="1600"
                  max="3600"
                  step="50"
                  value={spaceFreq}
                  disabled={isTransmitting}
                  onChange={(e) => setSpaceFreq(Number(e.target.value))}
                  className="w-full accent-cyan-500 cursor-pointer disabled:opacity-60"
                />
              </div>
            </div>

            {/* Volume / Attenuation Slider */}
            <div className="pt-2 border-t border-slate-800/80">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-300">音频输出电平幅度 (Volume):</span>
                <span className="font-mono text-cyan-400">{volume}% ({(20 * Math.log10(volume / 100)).toFixed(1)} dBFS)</span>
              </div>
              <input
                type="range"
                min="10"
                max="100"
                value={volume}
                disabled={isTransmitting}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="w-full accent-cyan-500 cursor-pointer disabled:opacity-60"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                💡 调试建议：对录线连接到对方麦克风时建议设置在 60%~80%，过高会导致接收端 ADC 削顶失真 (Clipping)。
              </p>
            </div>

            {/* Calibration Tones */}
            <div className="pt-2 border-t border-slate-800/80">
              <span className="text-xs text-slate-400 block mb-2">硬件链路校准纯音 (Tones):</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => toggleTone(markFreq)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition cursor-pointer ${
                    activeTone === markFreq
                      ? 'bg-amber-950 text-amber-300 border-amber-600'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-900'
                  }`}
                >
                  {activeTone === markFreq ? '⏹ 停止' : `▶ ${markFreq}Hz (Mark)`}
                </button>
                <button
                  type="button"
                  onClick={() => toggleTone(spaceFreq)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition cursor-pointer ${
                    activeTone === spaceFreq
                      ? 'bg-amber-950 text-amber-300 border-amber-600'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-900'
                  }`}
                >
                  {activeTone === spaceFreq ? '⏹ 停止' : `▶ ${spaceFreq}Hz (Space)`}
                </button>
                <button
                  type="button"
                  onClick={() => toggleTone(1000)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition cursor-pointer ${
                    activeTone === 1000
                      ? 'bg-amber-950 text-amber-300 border-amber-600'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-900'
                  }`}
                >
                  {activeTone === 1000 ? '⏹ 停止' : '▶ 1000Hz (标准参考音)'}
                </button>
              </div>
            </div>
          </div>

          {/* TAB SELECTION: Text vs File */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <button
                type="button"
                onClick={() => !isTransmitting && setActiveTab('text')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                  activeTab === 'text'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span>普通文本报文 (Text)</span>
              </button>

              <button
                type="button"
                onClick={() => !isTransmitting && setActiveTab('file')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                  activeTab === 'file'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileUp className="w-4 h-4" />
                <span>文件分卷传输 (File Transfer)</span>
                <span className="text-[10px] px-1.5 py-0.2 bg-cyan-900/60 text-cyan-300 rounded-full border border-cyan-700/50">新功能</span>
              </button>
            </div>

            {/* TAB CONTENT: TEXT */}
            {activeTab === 'text' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-white">报文内容与发送</h3>
                  <span className="text-xs font-mono text-slate-400">
                    {message.length} 字符 / {new TextEncoder().encode(message).length} 字节
                  </span>
                </div>

                <textarea
                  rows={3}
                  value={message}
                  disabled={isTransmitting}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="输入欲通过3.5mm耳机孔传输的字符串内容..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs sm:text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono disabled:opacity-60"
                />

                {/* Presets */}
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[11px] text-slate-500 self-center mr-1">快速填充:</span>
                  {textPresets.map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      disabled={isTransmitting}
                      onClick={() => setMessage(p.text)}
                      className="px-2 py-1 rounded bg-slate-950 hover:bg-slate-800 text-[11px] text-slate-300 border border-slate-800 hover:border-slate-700 transition cursor-pointer disabled:opacity-60"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Transmit Buttons */}
                <div className="pt-2 flex items-center gap-3">
                  <button
                    type="button"
                    disabled={isTransmitting}
                    onClick={handleSendText}
                    className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold py-3 px-4 rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    <span>{isTransmitting ? '正在播放调制音频...' : '调制并输出文本音频信号 (TX)'}</span>
                  </button>

                  {(isTransmitting || activeTone !== null) && (
                    <button
                      type="button"
                      onClick={handleStop}
                      className="bg-red-950/80 hover:bg-red-900 border border-red-700/80 text-red-300 font-medium py-3 px-4 rounded-xl text-sm flex items-center justify-center gap-2 transition cursor-pointer"
                    >
                      <Square className="w-4 h-4" />
                      <span>紧急停播</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: FILE TRANSFER */}
            {activeTab === 'file' && (
              <div className="space-y-4">
                {/* File Drop / Select Area */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                />

                <div
                  onClick={() => !isTransmitting && fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-5 text-center transition cursor-pointer ${
                    selectedFile
                      ? 'border-cyan-500/60 bg-cyan-950/10'
                      : 'border-slate-800 hover:border-slate-700 bg-slate-950/40'
                  }`}
                >
                  <Upload className="w-8 h-8 text-cyan-400 mx-auto mb-2" />
                  <div className="text-sm font-medium text-white">
                    {selectedFile ? selectedFile.name : '点击或拖拽选择欲传输的文件'}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {selectedFile
                      ? `大小: ${selectedFile.size} 字节 · 类型: ${selectedFile.mime}`
                      : '推荐传输小型文件 (小于 4KB)，如 JSON 配置、CSV 表格、传感器日志、PEM 密钥、微缩代码等'}
                  </p>
                </div>

                {/* Sample Files */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-slate-500">快速测试文件:</span>
                  <button
                    type="button"
                    disabled={isTransmitting}
                    onClick={() => loadSampleFile('json')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 text-xs text-cyan-300 border border-slate-800 hover:border-slate-700 transition cursor-pointer disabled:opacity-50"
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    <span>config.json</span>
                  </button>
                  <button
                    type="button"
                    disabled={isTransmitting}
                    onClick={() => loadSampleFile('csv')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 text-xs text-emerald-300 border border-slate-800 hover:border-slate-700 transition cursor-pointer disabled:opacity-50"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>sensors.csv</span>
                  </button>
                  <button
                    type="button"
                    disabled={isTransmitting}
                    onClick={() => loadSampleFile('text')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 text-xs text-amber-300 border border-slate-800 hover:border-slate-700 transition cursor-pointer disabled:opacity-50"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>note.txt</span>
                  </button>
                </div>

                {/* File Transfer Settings */}
                {selectedFile && (
                  <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800/80 space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-slate-400 block mb-1">单卷切片载荷 (Chunk Size):</span>
                        <select
                          value={chunkSize}
                          onChange={(e) => setChunkSize(Number(e.target.value))}
                          disabled={isTransmitting}
                          className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white"
                        >
                          <option value={32}>32 字节 (超稳小包)</option>
                          <option value={48}>48 字节 (推荐标准平衡)</option>
                          <option value={64}>64 字节 (大包高速)</option>
                        </select>
                      </div>

                      <div>
                        <span className="text-slate-400 block mb-1">分卷总数与预计耗时:</span>
                        <div className="font-mono text-cyan-400 py-1.5">
                          {Math.max(1, Math.ceil(selectedFile.size / chunkSize))} 个分卷 · {estimateFileDuration()}
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar if active */}
                    {fileProgress && (
                      <div className="space-y-1.5 pt-2 border-t border-slate-800">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-cyan-300 truncate">{fileProgress.currentPacketDesc}</span>
                          <span className="font-mono text-emerald-400 font-bold">{fileProgress.percent}%</span>
                        </div>
                        <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                          <div
                            className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-150"
                            style={{ width: `${fileProgress.percent}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 pt-1">
                      {!isTransmitting ? (
                        <button
                          type="button"
                          onClick={handleSendFile}
                          className="flex-1 bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold py-2.5 px-4 rounded-lg text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 transition cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>开始音频文件传输 ({Math.max(1, Math.ceil(selectedFile.size / chunkSize))} 分卷)</span>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={handlePauseResume}
                            className="flex-1 bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-700/80 font-medium py-2 px-3 rounded-lg text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                          >
                            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                            <span>{isPaused ? '恢复继续传输' : '暂停传输'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={handleStop}
                            className="bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-700/80 font-medium py-2 px-3 rounded-lg text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                          >
                            <Square className="w-3.5 h-3.5" />
                            <span>中止</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Oscilloscope & Telemetry */}
        <div className="lg:col-span-5 space-y-5">
          {/* Real-time Oscilloscope */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Waves className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-white">发送端波形示波器 (Oscilloscope)</h3>
              </div>
              <span className={`text-[11px] font-mono ${isTransmitting ? 'text-cyan-400 animate-pulse' : 'text-slate-400'}`}>
                {isTransmitting ? '● 正在发射' : '○ 空闲'}
              </span>
            </div>

            <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
              <canvas ref={canvasRef} className="w-full h-44 block" />
            </div>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300">
              <div className="flex justify-between items-center text-[11px] text-slate-500 mb-1">
                <span>传输状态跟踪</span>
                <span>{frameDuration}</span>
              </div>
              <div className="text-cyan-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                <span className="truncate">{statusText}</span>
              </div>
            </div>
          </div>

          {/* Telemetry Stats Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
            <h3 className="text-sm font-semibold text-white border-b border-slate-800 pb-2">
              发送端统计指标 (TX Telemetry)
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3">
                <div className="text-[11px] text-slate-500">累计成功发送包数</div>
                <div className="text-lg font-mono font-bold text-white mt-1">{sentPackets} <span className="text-xs text-slate-400 font-normal">帧</span></div>
              </div>

              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3">
                <div className="text-[11px] text-slate-500">累计发送有效载荷</div>
                <div className="text-lg font-mono font-bold text-cyan-400 mt-1">{sentBytes} <span className="text-xs text-slate-400 font-normal">字节</span></div>
              </div>

              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3">
                <div className="text-[11px] text-slate-500">前向纠错码开销</div>
                <div className="text-sm font-mono font-medium text-emerald-400 mt-1">
                  {useFEC ? '7:4 (1.75x 冗余)' : '1:1 (无额外开销)'}
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3">
                <div className="text-[11px] text-slate-500">调制频率间隔 (Shift)</div>
                <div className="text-sm font-mono font-medium text-slate-300 mt-1">
                  Δf = {Math.abs(spaceFreq - markFreq)} Hz
                </div>
              </div>
            </div>

            <div className="text-[11px] text-slate-400 leading-relaxed bg-slate-950/60 p-3 rounded-lg border border-slate-800">
              <b>传输协议架构：</b> 文件传输采用分卷打包机制（启动头帧 FILE_START、多包数据帧 FILE_DATA、校验尾帧 FILE_END）。每一帧均受独立 Hamming(7,4) 前向纠错与 CRC-16 保护；帧间插入 80ms 保护静音间隔，确保接收端硬件电平平稳过渡。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
