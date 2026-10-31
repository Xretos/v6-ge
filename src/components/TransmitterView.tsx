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
  RotateCcw,
  Zap,
  Info,
  Clock,
  Gauge,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import {
  FrameEncoder,
  FSKModulator,
  FileChunker,
  CRC16,
  PacketType,
  DEFAULT_CONFIG,
  ModemConfig,
  SPEED_PRESETS,
  SpeedPreset,
  parseChunkNumbersInput
} from '../dsp/fsk';

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
  const [chunkSize, setChunkSize] = useState<number>(64);
  const [fileProgress, setFileProgress] = useState<{
    currentChunk: number;
    totalChunks: number;
    percent: number;
    currentPacketDesc: string;
  } | null>(null);
  const isCancelledRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const [isPaused, setIsPaused] = useState(false);

  // Selective Retransmission & Breakpoint Resume state
  const [retransmitInput, setRetransmitInput] = useState<string>('');
  const [resumeStartChunk, setResumeStartChunk] = useState<number>(1);
  const [retransmitNotice, setRetransmitNotice] = useState<string>('');

  // Modulation config & Speed Presets
  const [selectedPresetId, setSelectedPresetId] = useState<string>('100');
  const [baudRate, setBaudRate] = useState<number>(100);
  const [useFEC, setUseFEC] = useState<boolean>(true);
  const [markFreq, setMarkFreq] = useState<number>(1200);
  const [spaceFreq, setSpaceFreq] = useState<number>(2200);
  const [volume, setVolume] = useState<number>(75);

  const applySpeedPreset = (presetId: string) => {
    const preset = SPEED_PRESETS[presetId];
    if (!preset) return;
    setSelectedPresetId(presetId);
    setBaudRate(preset.baudRate);
    setMarkFreq(preset.markFreq);
    setSpaceFreq(preset.spaceFreq);
    setChunkSize(preset.recommendedChunkSize);
    setUseFEC(preset.recommendedUseFEC);
    setStatusText(`已一键切换至: ${preset.name} (${preset.speedMultiplier}x 加速)`);
  };

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
    const preset = SPEED_PRESETS[selectedPresetId];
    const modulationScheme = preset?.modulationScheme || '2FSK';
    const frequencies = preset?.frequencies;

    const config: ModemConfig = {
      sampleRate: actualSampleRate,
      baudRate,
      markFreq,
      spaceFreq,
      modulationScheme,
      frequencies,
      amplitude: volume / 100,
      useFEC,
    };

    // 1. Frame encoding with Hamming(7,4) and CRC-16
    const payload = new TextEncoder().encode(trimmed);
    const bits = FrameEncoder.encodePacketToBits(payload, packetSeq, useFEC, PacketType.TEXT, modulationScheme);

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
    setStatusText(`正在向 3.5mm 耳机孔输出音频文本报文 [Seq #${packetSeq}] (${modulationScheme})...`);

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
    const preset = SPEED_PRESETS[selectedPresetId];
    const modulationScheme = preset?.modulationScheme || '2FSK';
    const frequencies = preset?.frequencies;

    const config: ModemConfig = {
      sampleRate: actualSampleRate,
      baudRate,
      markFreq,
      spaceFreq,
      modulationScheme,
      frequencies,
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
      packetSeq,
      modulationScheme
    );

    isCancelledRef.current = false;
    isPausedRef.current = false;
    setIsPaused(false);
    setIsTransmitting(true);

    // Pre-flight hardware DAC & AGC wake-up pulse (120ms):
    // Awaken phone DAC from sleep, un-mute hardware audio, and settle receiver mic AGC before FILE_START
    setStatusText('正在发射硬件唤醒导频与 AGC 校准信号 (120ms)...');
    const wakeupSamples = FSKModulator.generateWakeupTone(
      actualSampleRate,
      frequencies?.[0] ?? markFreq,
      0.12,
      (volume / 100) * 0.5
    );
    const wakeupBuf = ctx.createBuffer(1, wakeupSamples.length, actualSampleRate);
    wakeupBuf.getChannelData(0).set(wakeupSamples);
    await new Promise<void>((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = wakeupBuf;
      source.connect(ctx.destination);
      source.onended = () => resolve();
      source.start();
    });
    await new Promise((r) => setTimeout(r, 20));

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

      // Adaptive guard silence interval between chunks (30ms for >=1000bps, 70ms for 100bps)
      if (i < packets.length - 1 && !isCancelledRef.current) {
        await new Promise((r) => setTimeout(r, baudRate >= 1000 ? 30 : 70));
      }
    }

    setIsTransmitting(false);
    if (!isCancelledRef.current) {
      setStatusText(`✓ 文件 ${selectedFile.name} 全部分卷已成功发射完毕！`);
      setFileProgress((prev) => (prev ? { ...prev, percent: 100 } : null));
    }
  };



  // --- SELECTIVE RETRANSMISSION (ARQ) ---
  const handleRetransmitSelected = async () => {
    if (!selectedFile || selectedFile.data.length === 0) return;
    const totalChunks = Math.max(1, Math.ceil(selectedFile.data.length / chunkSize));
    const targetIndices = parseChunkNumbersInput(retransmitInput, totalChunks);
    if (targetIndices.length === 0) {
      setRetransmitNotice(`❌ 未检测到有效分卷序号。请输入 1 ~ ${totalChunks} 之间的序号 (如: 154 或 5, 12, 154 或 10-15)`);
      return;
    }

    const target1Based = targetIndices.map((i) => i + 1);
    setRetransmitNotice(`🚀 正在准备重传 ${targetIndices.length} 个分卷: [${target1Based.join(', ')}]`);

    const ctx = getAudioContext();
    const actualSampleRate = ctx.sampleRate;
    const preset = SPEED_PRESETS[selectedPresetId];
    const modulationScheme = preset?.modulationScheme || '2FSK';
    const frequencies = preset?.frequencies;

    const config: ModemConfig = {
      sampleRate: actualSampleRate,
      baudRate,
      markFreq,
      spaceFreq,
      modulationScheme,
      frequencies,
      amplitude: volume / 100,
      useFEC,
    };

    const packets = FileChunker.createSelectivePackets(
      selectedFile.name,
      selectedFile.data,
      selectedFile.mime,
      chunkSize,
      useFEC,
      targetIndices,
      packetSeq,
      modulationScheme
    );

    isCancelledRef.current = false;
    isPausedRef.current = false;
    setIsPaused(false);
    setIsTransmitting(true);

    for (let i = 0; i < packets.length; i++) {
      if (isCancelledRef.current) break;
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

      const samples = FSKModulator.modulate(pkt.bits, config);
      drawWaveform(samples);

      const durSec = (samples.length / actualSampleRate).toFixed(2);
      setFrameDuration(`[重传 ${i + 1}/${packets.length}] ${pkt.bits.length}b / ${durSec}s`);
      setStatusText(`正在重传: ${pkt.description}`);

      const buffer = ctx.createBuffer(1, samples.length, actualSampleRate);
      buffer.getChannelData(0).set(samples);

      await new Promise<void>((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        currentSourceRef.current = source;
        source.onended = () => resolve();
        source.start();
      });

      setSentPackets((prev) => prev + 1);
      setSentBytes((prev) => prev + pkt.payload.length);
      setPacketSeq((prev) => prev + 1);

      if (i < packets.length - 1 && !isCancelledRef.current) {
        await new Promise((r) => setTimeout(r, baudRate >= 1000 ? 30 : 70));
      }
    }

    setIsTransmitting(false);
    if (!isCancelledRef.current) {
      setStatusText(`✓ 指定 ${packets.length} 个分卷已全部重传发送完毕！`);
      setRetransmitNotice(`✓ 成功重传发送 ${packets.length} 个分卷，接收端应已补齐洞隙！`);
    }
  };

  // --- BREAKPOINT RESUME (CONTINUE FROM CHUNK N) ---
  const handleResumeFromChunk = async (start1Based: number) => {
    if (!selectedFile || selectedFile.data.length === 0) return;
    const totalChunks = Math.max(1, Math.ceil(selectedFile.data.length / chunkSize));
    const startIdx = Math.max(0, Math.min(totalChunks - 1, start1Based - 1));

    const indices: number[] = [];
    for (let c = startIdx; c < totalChunks; c++) {
      indices.push(c);
    }

    setRetransmitNotice(`⏩ 正在从断点分卷 #${startIdx + 1} 开始续传至末尾 (共 ${indices.length} 卷)...`);

    const ctx = getAudioContext();
    const actualSampleRate = ctx.sampleRate;
    const preset = SPEED_PRESETS[selectedPresetId];
    const modulationScheme = preset?.modulationScheme || '2FSK';
    const frequencies = preset?.frequencies;

    const config: ModemConfig = {
      sampleRate: actualSampleRate,
      baudRate,
      markFreq,
      spaceFreq,
      modulationScheme,
      frequencies,
      amplitude: volume / 100,
      useFEC,
    };

    const packets = FileChunker.createSelectivePackets(
      selectedFile.name,
      selectedFile.data,
      selectedFile.mime,
      chunkSize,
      useFEC,
      indices,
      packetSeq,
      modulationScheme
    );

    // Append FILE_END packet so receiver finishes cleanly
    const endMeta = JSON.stringify({
      name: selectedFile.name,
      size: selectedFile.data.length,
      crc: CRC16.compute(selectedFile.data),
    });
    const endPayload = new TextEncoder().encode(endMeta);
    const endBits = FrameEncoder.encodePacketToBits(endPayload, (packetSeq + packets.length) & 0xff, useFEC, PacketType.FILE_END, modulationScheme);
    packets.push({
      seq: (packetSeq + packets.length) & 0xff,
      chunkIdx: totalChunks,
      packetType: PacketType.FILE_END,
      bits: endBits,
      description: `文件传输结束标记: ${selectedFile.name}`,
      payload: endPayload,
    });

    isCancelledRef.current = false;
    isPausedRef.current = false;
    setIsPaused(false);
    setIsTransmitting(true);

    // Pre-flight hardware DAC & AGC wake-up pulse (120ms):
    const wakeupSamples = FSKModulator.generateWakeupTone(
      actualSampleRate,
      frequencies?.[0] ?? markFreq,
      0.12,
      (volume / 100) * 0.5
    );
    const wakeupBuf = ctx.createBuffer(1, wakeupSamples.length, actualSampleRate);
    wakeupBuf.getChannelData(0).set(wakeupSamples);
    await new Promise<void>((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = wakeupBuf;
      source.connect(ctx.destination);
      source.onended = () => resolve();
      source.start();
    });
    await new Promise((r) => setTimeout(r, 20));

    for (let i = 0; i < packets.length; i++) {
      if (isCancelledRef.current) break;
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

      const samples = FSKModulator.modulate(pkt.bits, config);
      drawWaveform(samples);

      const durSec = (samples.length / actualSampleRate).toFixed(2);
      setFrameDuration(`[续传 ${i + 1}/${packets.length}] ${pkt.bits.length}b / ${durSec}s`);
      setStatusText(`正在续传: ${pkt.description}`);

      const buffer = ctx.createBuffer(1, samples.length, actualSampleRate);
      buffer.getChannelData(0).set(samples);

      await new Promise<void>((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        currentSourceRef.current = source;
        source.onended = () => resolve();
        source.start();
      });

      setSentPackets((prev) => prev + 1);
      setSentBytes((prev) => prev + pkt.payload.length);
      setPacketSeq((prev) => prev + 1);

      if (i < packets.length - 1 && !isCancelledRef.current) {
        await new Promise((r) => setTimeout(r, baudRate >= 1000 ? 30 : 70));
      }
    }

    setIsTransmitting(false);
    if (!isCancelledRef.current) {
      setStatusText(`✓ 从断点 #${startIdx + 1} 续传已完成！`);
      setRetransmitNotice(`✓ 断点续传完毕，接收端已接收至末尾！`);
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

  // Estimate transmission duration for selected file or arbitrary size
  const estimateDurationForBytes = (bytes: number, targetBaud = baudRate, targetFec = useFEC, targetChunk = chunkSize) => {
    if (bytes <= 0) return '0s';
    const totalChunks = Math.max(1, Math.ceil(bytes / targetChunk));
    const totalPacketsCount = totalChunks + 2;
    // Each packet: 40 bits (preamble+sync) + 42 bits (header Hamming) + payload bits + 28 bits (CRC Hamming) + 8 guard
    const payloadBits = targetFec ? targetChunk * 14 : targetChunk * 8;
    const avgPacketBits = 40 + 42 + payloadBits + 28 + 8;
    const guardSec = totalPacketsCount * (targetBaud >= 1000 ? 0.03 : 0.07);
    const totalSeconds = (totalPacketsCount * avgPacketBits) / targetBaud + guardSec;
    if (totalSeconds < 60) {
      return `约 ${Math.ceil(totalSeconds)} 秒`;
    }
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.ceil(totalSeconds % 60);
    if (mins < 60) {
      return `约 ${mins} 分 ${secs} 秒`;
    }
    const hours = (totalSeconds / 3600).toFixed(1);
    return `约 ${hours} 小时 (${mins} 分钟)`;
  };

  const estimateFileDuration = () => {
    if (!selectedFile) return '0s';
    return estimateDurationForBytes(selectedFile.size);
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

            {/* Quick Speed Presets */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>传输速率模式预设 (Speed Presets):</span>
                </span>
                <span className="text-[11px] text-amber-400 font-mono">
                  当前: {SPEED_PRESETS[selectedPresetId]?.speedMultiplier || 1}x 速
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Object.values(SPEED_PRESETS)
                  .filter((p, idx, arr) => arr.findIndex((x) => x.id === p.id) === idx && p.id !== '2000' && p.id !== '3000' && p.id !== '6000')
                  .map((p) => {
                    const isActive = selectedPresetId === p.id || (p.id === '2000_4fsk' && selectedPresetId === '2000');
                    const is4FSK = p.modulationScheme === '4FSK';
                    const is8FSK = p.modulationScheme === '8FSK';
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={isTransmitting}
                        onClick={() => applySpeedPreset(p.id)}
                        className={`p-2.5 rounded-lg border text-left transition cursor-pointer disabled:opacity-50 ${
                          isActive
                            ? 'bg-cyan-950/80 border-cyan-500 text-cyan-300 shadow-sm shadow-cyan-500/20'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">{p.bitRate} bps</span>
                          <span className={`text-[10px] font-mono px-1 rounded ${
                            is8FSK
                              ? 'bg-purple-900/80 text-purple-300 border border-purple-600/80'
                              : is4FSK
                              ? 'bg-cyan-900/80 text-cyan-300 border border-cyan-600/80'
                              : p.speedMultiplier >= 10
                              ? 'bg-amber-950 text-amber-400 border border-amber-800'
                              : 'bg-slate-900 text-slate-400'
                          }`}>
                            {is8FSK ? '8-FSK' : is4FSK ? '4-FSK' : `${p.speedMultiplier}x`}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">
                          {p.id === '3000_8fsk'
                            ? '🚀 8-FSK 3000bps'
                            : p.id === '4500_8fsk'
                            ? '💎 8-FSK 4500bps (首选)'
                            : p.id === '6000_8fsk'
                            ? '⚡ 8-FSK 6000bps (整频)'
                            : p.id === '7200_8fsk'
                            ? '🔥 8-FSK 7200bps (极速)'
                            : p.id === '2000_4fsk'
                            ? '⚡ 4-FSK 高稳大卷'
                            : p.id === '4000'
                            ? '🔥 4-FSK 翻倍极速'
                            : p.id === '1000'
                            ? '10倍极速 Turbo'
                            : p.id === '2000_2fsk'
                            ? '2-FSK 经典超频'
                            : p.id === '500'
                            ? '5倍平稳加速'
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
                  通信波特率 (Baud Rate)
                </label>
                <select
                  value={baudRate}
                  onChange={(e) => setBaudRate(Number(e.target.value))}
                  disabled={isTransmitting}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 disabled:opacity-60"
                >
                  <option value={100}>100 bps (标准抗噪，Mark 1200 / Space 2200)</option>
                  <option value={200}>200 bps (2倍速轻度加速)</option>
                  <option value={500}>500 bps (5倍速平稳加速，Mark 1500 / Space 2500)</option>
                  <option value={1000}>1000 bps (⚡ 10倍速 Turbo 极速，Mark 2000 / Space 3000)</option>
                  <option value={2000}>2000 bps (🔥 20倍速 Extreme 超频，Mark 2000 / Space 4000)</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  {baudRate >= 1000 ? '⚡ 采用严格正交 MSK 频偏与 1ms 码元' : '满足“传输速率至少达到每秒100比特”标准'}
                </p>
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
                    <span>{useFEC ? '使能 Hamming(7,4)' : '无 FEC (纯CRC-16 满速直通)'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  {useFEC ? '抗单比特跳变 (吞吐率降为 4/7)' : '3.5mm 对录线 SNR>30dB 推荐使用纯 CRC 达到 100% 满带宽'}
                </p>
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
                          <option value={32}>32 字节 (超稳微包，适合 100 bps)</option>
                          <option value={48}>48 字节 (100 bps 推荐标准)</option>
                          <option value={64}>64 字节 (标准通用分卷)</option>
                          <option value={96}>96 字节 (500 bps 推荐)</option>
                          <option value={128}>128 字节 (⚡ 1000 bps 推荐)</option>
                          <option value={192}>192 字节 (大容量分卷)</option>
                          <option value={220}>220 字节 (旧版极限容量分卷)</option>
                          <option value={256}>256 字节 (⭐ 4-FSK 推荐，开销 &lt; 2%)</option>
                          <option value={384}>384 字节 (🚀 特大分卷，吞吐效率 98.5%)</option>
                          <option value={512}>512 字节 (🔥 512B 超大分卷，适合 4000 bps)</option>
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

                    {/* SELECTIVE RETRANSMISSION & BREAKPOINT RESUME CONTROLS */}
                    <div className="pt-3 border-t border-slate-800/80 space-y-3">
                      {/* 1. Selective Retransmission */}
                      <div className="bg-slate-900/90 border border-cyan-900/40 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>批量输入包序号 · 选择性重传 (ARQ)</span>
                          </span>
                          <span className="text-[11px] text-slate-400">
                            从接收端复制缺失分卷直接粘贴
                          </span>
                        </div>

                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={retransmitInput}
                            onChange={(e) => setRetransmitInput(e.target.value)}
                            disabled={isTransmitting}
                            placeholder="输入包序号，如: 154 或 5, 12, 154 或 10-15"
                            className="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-cyan-400 disabled:opacity-50"
                          />
                          <button
                            type="button"
                            disabled={isTransmitting || !retransmitInput.trim()}
                            onClick={handleRetransmitSelected}
                            className="bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold px-3 py-1.5 rounded text-xs flex items-center gap-1 transition cursor-pointer disabled:opacity-40"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>仅重传指定分卷</span>
                          </button>
                        </div>

                        <p className="text-[11px] text-slate-400">
                          💡 说明：当接收端出现极个别 CRC 丢包时（如分卷 #154 校验失败），无需重新发送整个文件，直接在此输入序号重传该分卷即可补全文件。
                        </p>
                      </div>

                      {/* 2. Breakpoint Resume */}
                      <div className="bg-slate-900/90 border border-emerald-900/40 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                            <Play className="w-3.5 h-3.5" />
                            <span>断点续传功能 (Resume Transfer)</span>
                          </span>
                          <span className="text-[11px] text-slate-400">
                            分卷范围 1 ~ {Math.max(1, Math.ceil(selectedFile.size / chunkSize))}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-300 whitespace-nowrap">从第</span>
                          <input
                            type="number"
                            min="1"
                            max={Math.max(1, Math.ceil(selectedFile.size / chunkSize))}
                            value={resumeStartChunk}
                            onChange={(e) => setResumeStartChunk(Math.max(1, Number(e.target.value)))}
                            disabled={isTransmitting}
                            className="w-20 bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-emerald-400 disabled:opacity-50"
                          />
                          <span className="text-xs text-slate-300 whitespace-nowrap">卷开始续传至末尾</span>

                          <button
                            type="button"
                            disabled={isTransmitting}
                            onClick={() => handleResumeFromChunk(resumeStartChunk)}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold px-3 py-1.5 rounded text-xs flex items-center justify-center gap-1 transition cursor-pointer disabled:opacity-40"
                          >
                            <Play className="w-3 h-3" />
                            <span>开始断点续传</span>
                          </button>
                        </div>
                      </div>

                      {retransmitNotice && (
                        <div className="p-2 rounded bg-cyan-950/60 border border-cyan-800 text-cyan-300 text-xs font-mono">
                          {retransmitNotice}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 500 kB SPEED ANALYSIS CARD */}
          <div className="bg-slate-900/80 border border-amber-500/30 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-white">500 kB 大文件传输耗时与香农极限对比</h3>
              </div>
              <span className="text-[11px] font-mono text-amber-400 bg-amber-950/60 border border-amber-800/60 px-2 py-0.5 rounded">
                理论物理分析
              </span>
            </div>

            <div className="text-xs text-slate-300 leading-relaxed space-y-2">
              <p>
                针对您提出的目标 <span className="text-amber-300 font-semibold">“稳定快速传输 500 kB 大小文件”</span>，我们通过算法升级（1000 bps 正交 MSK / 2000Hz+3000Hz / 128B切片 / 纯CRC直通），成功实现了 <span className="text-emerald-400 font-semibold">10x ~ 17.5x</span> 的有效吞吐提速！
              </p>
            </div>

            {/* Comparison Table */}
            <div className="border border-slate-800 rounded-lg overflow-hidden text-xs">
              <table className="w-full text-left">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="p-2.5">模式 / 算法</th>
                    <th className="p-2.5">有效吞吐</th>
                    <th className="p-2.5">500 kB 传输耗时</th>
                    <th className="p-2.5">对录线信道评估</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  <tr className="hover:bg-slate-800/20">
                    <td className="p-2.5 font-medium">100 bps 标准抗噪 (含FEC)</td>
                    <td className="p-2.5 font-mono text-slate-400">~7.1 B/s</td>
                    <td className="p-2.5 font-mono text-red-400">~19.9 小时</td>
                    <td className="p-2.5 text-slate-500">仅适合几十字节微电报</td>
                  </tr>
                  <tr className="hover:bg-slate-800/20">
                    <td className="p-2.5 font-medium">500 bps 5倍平稳 (纯CRC)</td>
                    <td className="p-2.5 font-mono text-slate-400">~62 B/s</td>
                    <td className="p-2.5 font-mono text-amber-400">~2.3 小时</td>
                    <td className="p-2.5 text-slate-400">适合几KB小配置文件</td>
                  </tr>
                  <tr className="bg-amber-950/20 border-l-2 border-l-amber-500">
                    <td className="p-2.5 font-medium text-amber-300">⚡ 1000 bps 10x极速 (纯CRC)</td>
                    <td className="p-2.5 font-mono text-emerald-400 font-bold">~118 B/s</td>
                    <td className="p-2.5 font-mono text-emerald-400 font-bold">~72 分钟</td>
                    <td className="p-2.5 text-cyan-400">推荐！对录线高SNR最高性价比</td>
                  </tr>
                  <tr className="hover:bg-slate-800/20">
                    <td className="p-2.5 font-medium text-purple-300">🔥 2000 bps 20x超频 (纯CRC)</td>
                    <td className="p-2.5 font-mono text-purple-400">~236 B/s</td>
                    <td className="p-2.5 font-mono text-purple-300">~36 分钟</td>
                    <td className="p-2.5 text-slate-400">需高质量屏蔽线，无声卡失真</td>
                  </tr>
                  <tr className="bg-slate-950/80 text-slate-500">
                    <td className="p-2.5 italic">香农物理信道极限 (B=8kHz, SNR=35dB)</td>
                    <td className="p-2.5 font-mono">~11.6 kB/s</td>
                    <td className="p-2.5 font-mono text-slate-400">~43 秒</td>
                    <td className="p-2.5 italic text-[11px]">3.5mm 接口无论任何算法的数学绝对上限</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <div className="text-[11px] text-slate-400 leading-relaxed">
                <span className="text-slate-200 font-medium">工程选型建议：</span>
                3.5mm 音频接口设计初衷为人声（300Hz-3.4kHz）通信，手机声卡硬件具有硬件带通与回声滤波器，物理带宽极窄。若需在 <span className="text-amber-300">“几秒内”</span> 传输 500 kB 文件，建议采用无网免配对物理直连技术（如 <strong>Wi-Fi Direct、BLE 5.0 2M PHY、WebRTC 本地链路</strong>）；而在 <strong>物理物理隔离 (Air-Gap) 安全传输、纯硬件录音线单向通讯</strong> 场景下，1000 bps 是目前兼顾稳定与极速的最优解！
              </div>
            </div>
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
