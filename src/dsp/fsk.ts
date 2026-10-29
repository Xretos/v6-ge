/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ============================================================================
// 1. FORWARD ERROR CORRECTION: Hamming(7,4) Code
// ============================================================================
// Data nibble (d1, d2, d3, d4) -> 7-bit codeword (p1, p2, d1, p3, d2, d3, d4)
// Can correct any 1-bit error per 4 data bits and detect parity violations.

export class Hamming74 {
  /**
   * Encodes a 4-bit nibble (0-15) into a 7-bit codeword (0-127).
   */
  static encodeNibble(nibble: number): number {
    const d1 = (nibble >> 3) & 1;
    const d2 = (nibble >> 2) & 1;
    const d3 = (nibble >> 1) & 1;
    const d4 = nibble & 1;

    // Parity equations
    const p1 = d1 ^ d2 ^ d4;
    const p2 = d1 ^ d3 ^ d4;
    const p3 = d2 ^ d3 ^ d4;

    // 7-bit codeword: bit6=p1, bit5=p2, bit4=d1, bit3=p3, bit2=d2, bit1=d3, bit0=d4
    return (p1 << 6) | (p2 << 5) | (d1 << 4) | (p3 << 3) | (d2 << 2) | (d3 << 1) | d4;
  }

  /**
   * Decodes a 7-bit codeword, corrects 1-bit error if found.
   * Returns { nibble: 0..15, corrected: boolean, errorBitIndex: number (-1 if none) }
   */
  static decodeNibble(codeword: number): { nibble: number; corrected: boolean; errorBitIndex: number } {
    let bits = codeword & 0x7f;
    const r1 = (bits >> 6) & 1; // p1 (pos 1)
    const r2 = (bits >> 5) & 1; // p2 (pos 2)
    const r3 = (bits >> 4) & 1; // d1 (pos 3)
    const r4 = (bits >> 3) & 1; // p3 (pos 4)
    const r5 = (bits >> 2) & 1; // d2 (pos 5)
    const r6 = (bits >> 1) & 1; // d3 (pos 6)
    const r7 = bits & 1;        // d4 (pos 7)

    // Calculate syndrome (1-based index where error occurred)
    const s1 = r1 ^ r3 ^ r5 ^ r7;
    const s2 = r2 ^ r3 ^ r6 ^ r7;
    const s3 = r4 ^ r5 ^ r6 ^ r7;
    const syndrome = (s3 << 2) | (s2 << 1) | s1; // 0..7

    let corrected = false;
    let errorBitIndex = -1;

    if (syndrome > 0 && syndrome <= 7) {
      // Flip the erroneous bit (syndrome 1 -> pos 1, bit 6; syndrome 7 -> pos 7, bit 0)
      const shift = 7 - syndrome;
      bits ^= (1 << shift);
      corrected = true;
      errorBitIndex = syndrome;
    }

    // Extract corrected data bits: d1(pos 3/shift 4), d2(pos 5/shift 2), d3(pos 6/shift 1), d4(pos 7/shift 0)
    const d1 = (bits >> 4) & 1;
    const d2 = (bits >> 2) & 1;
    const d3 = (bits >> 1) & 1;
    const d4 = bits & 1;
    const nibble = (d1 << 3) | (d2 << 2) | (d3 << 1) | d4;

    return { nibble, corrected, errorBitIndex };
  }

  /**
   * Encodes a byte into two 7-bit codewords (14 bits total).
   */
  static encodeByte(byte: number): [number, number] {
    const high = (byte >> 4) & 0x0f;
    const low = byte & 0x0f;
    return [this.encodeNibble(high), this.encodeNibble(low)];
  }

  /**
   * Decodes two 7-bit codewords back into a byte.
   */
  static decodeByte(highCode: number, lowCode: number): { byte: number; corrections: number } {
    const resHigh = this.decodeNibble(highCode);
    const resLow = this.decodeNibble(lowCode);
    const byte = (resHigh.nibble << 4) | resLow.nibble;
    const corrections = (resHigh.corrected ? 1 : 0) + (resLow.corrected ? 1 : 0);
    return { byte, corrections };
  }
}

// ============================================================================
// 2. CHECKSUM: CRC-16-CCITT
// ============================================================================
export class CRC16 {
  static compute(data: Uint8Array): number {
    let crc = 0xffff;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i] << 8;
      for (let bit = 0; bit < 8; bit++) {
        if ((crc & 0x8000) !== 0) {
          crc = ((crc << 1) ^ 0x1021) & 0xffff;
        } else {
          crc = (crc << 1) & 0xffff;
        }
      }
    }
    return crc & 0xffff;
  }

  static verify(data: Uint8Array, expectedCrc: number): boolean {
    return this.compute(data) === (expectedCrc & 0xffff);
  }
}

// ============================================================================
// 3. PACKET & PROTOCOL DEFINITIONS
// ============================================================================
export const PREAMBLE_BITS = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]; // 24 bits for rock-solid lock
export const SYNC_WORD = 0xd391; // 16-bit Barker-like sync sequence: 11010011 10010001
export const SYNC_BITS = [1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1]; // 16 bits

export interface ModemConfig {
  sampleRate: number;      // e.g. 44100, 48000
  baudRate: number;        // e.g. 100, 150, 200, 300 baud
  markFreq: number;        // bit '1' frequency (e.g. 1200 Hz)
  spaceFreq: number;       // bit '0' frequency (e.g. 2200 Hz)
  amplitude: number;       // 0.0 - 1.0 (recommended 0.75)
  useFEC: boolean;         // Enable Hamming(7,4) forward error correction
}

export const DEFAULT_CONFIG: ModemConfig = {
  sampleRate: 48000,
  baudRate: 100, // 100 bps default, meets >= 100 bps requirement
  markFreq: 1200,
  spaceFreq: 2200,
  amplitude: 0.75,
  useFEC: true,
};

export interface SpeedPreset {
  id: string;
  name: string;
  baudRate: number;
  markFreq: number;
  spaceFreq: number;
  recommendedChunkSize: number;
  recommendedUseFEC: boolean;
  speedMultiplier: number;
  description: string;
  throughputDesc: string;
  est500kDuration: string;
}

export const SPEED_PRESETS: Record<string, SpeedPreset> = {
  '100': {
    id: '100',
    name: '100 bps (标准抗噪模式)',
    baudRate: 100,
    markFreq: 1200,
    spaceFreq: 2200,
    recommendedChunkSize: 48,
    recommendedUseFEC: true,
    speedMultiplier: 1,
    description: 'Bell 202 兼容，抗干扰极强，适合恶劣模拟链路或劣质音频线',
    throughputDesc: '有效 ~7.1 字节/秒 (含FEC)',
    est500kDuration: '约 19.9 小时 (纯数据理论 ~11.4 小时)',
  },
  '500': {
    id: '500',
    name: '500 bps (5倍速 平稳加速)',
    baudRate: 500,
    markFreq: 1500,
    spaceFreq: 2500,
    recommendedChunkSize: 96,
    recommendedUseFEC: true,
    speedMultiplier: 5,
    description: '平稳加速，适合普通 3.5mm 对录线与各类安卓手机',
    throughputDesc: '有效 ~35 字节/秒 (含FEC) / ~62 字节/秒 (纯CRC)',
    est500kDuration: '约 2.3 小时 (纯CRC模式)',
  },
  '1000': {
    id: '1000',
    name: '1000 bps (10倍速 极速 Turbo)',
    baudRate: 1000,
    markFreq: 2000,
    spaceFreq: 3000,
    recommendedChunkSize: 192,
    recommendedUseFEC: false, // On 3.5mm cable SNR>30dB, pure CRC provides 100% throughput!
    speedMultiplier: 10,
    description: '精准正交 MSK/CPFSK 调制 (Δf=1000Hz=1/Ts)，对录线零串扰黄金频段',
    throughputDesc: '有效 ~118 字节/秒 (纯CRC) / ~71 字节/秒 (含FEC)',
    est500kDuration: '约 72 分钟 (纯CRC模式)',
  },
  '2000': {
    id: '2000',
    name: '2000 bps (20倍速 超频 Extreme)',
    baudRate: 2000,
    markFreq: 2000,
    spaceFreq: 4000,
    recommendedChunkSize: 220,
    recommendedUseFEC: false,
    speedMultiplier: 20,
    description: '20倍极致速率，要求高品质金属编织屏蔽对录线及无失真输出',
    throughputDesc: '有效 ~236 字节/秒 (纯CRC) / ~142 字节/秒 (含FEC)',
    est500kDuration: '约 36 分钟 (纯CRC模式)',
  },
};

export enum PacketType {
  TEXT = 0,
  FILE_START = 1,
  FILE_DATA = 2,
  FILE_END = 3,
}

export interface FileMeta {
  name: string;
  size: number;
  chunks: number;
  mime?: string;
  chunkIdx?: number;
  totalChunks?: number;
  chunkData?: Uint8Array;
  crc?: number;
}

export interface DecodedPacket {
  seq: number;
  payload: Uint8Array;
  text?: string;
  packetType: PacketType;
  fileMeta?: FileMeta;
  crcValid: boolean;
  crcExpected: number;
  crcReceived: number;
  fecCorrections: number;
  snrDb?: number;
  timestamp: number;
}

// ============================================================================
// 4. FRAME ENCODER & FILE CHUNKER
// ============================================================================
export class FrameEncoder {
  /**
   * Builds the complete bitstream for a payload (Preamble + Sync + Header + Payload + CRC)
   */
  static encodePacketToBits(
    payload: Uint8Array,
    seq: number,
    useFEC: boolean,
    packetType: PacketType = PacketType.TEXT
  ): number[] {
    const bits: number[] = [];

    // 1. Preamble (allows receiver AGC & symbol clock to synchronize)
    for (const b of PREAMBLE_BITS) {
      bits.push(b);
    }

    // 2. Sync word
    for (const b of SYNC_BITS) {
      bits.push(b);
    }

    // 3. Header: [seq (1 byte), len (1 byte), flags (1 byte)]
    // Flags: bit 0: useFEC, bits 1..3: packetType
    const flags = (useFEC ? 0x01 : 0x00) | ((packetType & 0x07) << 1);
    const headerBytes = new Uint8Array([seq & 0xff, payload.length & 0xff, flags]);

    // 4. Checksum data: header + payload
    const dataForCrc = new Uint8Array(headerBytes.length + payload.length);
    dataForCrc.set(headerBytes, 0);
    dataForCrc.set(payload, headerBytes.length);
    const crc = CRC16.compute(dataForCrc);

    // 5. Encode header into bits (Headers are always protected with Hamming(7,4))
    for (const byte of headerBytes) {
      const [highCode, lowCode] = Hamming74.encodeByte(byte);
      for (let i = 6; i >= 0; i--) bits.push((highCode >> i) & 1);
      for (let i = 6; i >= 0; i--) bits.push((lowCode >> i) & 1);
    }

    // 6. Encode payload into bits
    if (useFEC) {
      for (const byte of payload) {
        const [highCode, lowCode] = Hamming74.encodeByte(byte);
        for (let i = 6; i >= 0; i--) bits.push((highCode >> i) & 1);
        for (let i = 6; i >= 0; i--) bits.push((lowCode >> i) & 1);
      }
    } else {
      for (const byte of payload) {
        for (let i = 7; i >= 0; i--) {
          bits.push((byte >> i) & 1);
        }
      }
    }

    // 7. Encode CRC (2 bytes) with Hamming(7,4)
    const crcHigh = (crc >> 8) & 0xff;
    const crcLow = crc & 0xff;
    const [ch1, ch2] = Hamming74.encodeByte(crcHigh);
    const [cl1, cl2] = Hamming74.encodeByte(crcLow);
    for (let i = 6; i >= 0; i--) bits.push((ch1 >> i) & 1);
    for (let i = 6; i >= 0; i--) bits.push((ch2 >> i) & 1);
    for (let i = 6; i >= 0; i--) bits.push((cl1 >> i) & 1);
    for (let i = 6; i >= 0; i--) bits.push((cl2 >> i) & 1);

    // 8. Flush guard bits (8 bits of 1s)
    bits.push(1, 1, 1, 1, 1, 1, 1, 1);

    return bits;
  }
}

// ============================================================================
// 4.1. FILE CHUNKER & PACKETIZER
// ============================================================================
export class FileChunker {
  /**
   * Splits a file into an array of packets: 1 FILE_START, N FILE_DATA, and 1 FILE_END
   */
  static createFilePackets(
    filename: string,
    fileBytes: Uint8Array,
    mimeType: string = 'application/octet-stream',
    chunkSize: number = 48,
    useFEC: boolean = true,
    startSeq: number = 1
  ): { seq: number; packetType: PacketType; bits: number[]; description: string; payload: Uint8Array }[] {
    const totalChunks = Math.max(1, Math.ceil(fileBytes.length / chunkSize));
    const packets = [];
    let curSeq = startSeq;

    // 1. FILE_START packet
    const meta = JSON.stringify({
      name: filename,
      size: fileBytes.length,
      chunks: totalChunks,
      mime: mimeType,
    });
    const metaPayload = new TextEncoder().encode(meta);
    const startBits = FrameEncoder.encodePacketToBits(metaPayload, curSeq & 0xff, useFEC, PacketType.FILE_START);
    packets.push({
      seq: curSeq & 0xff,
      packetType: PacketType.FILE_START,
      bits: startBits,
      description: `文件传输启动: ${filename} (${fileBytes.length} 字节, ${totalChunks} 分卷)`,
      payload: metaPayload,
    });
    curSeq++;

    // 2. FILE_DATA packets
    for (let c = 0; c < totalChunks; c++) {
      const slice = fileBytes.subarray(c * chunkSize, Math.min(fileBytes.length, (c + 1) * chunkSize));
      const chunkPayload = new Uint8Array(4 + slice.length);
      chunkPayload[0] = (c >> 8) & 0xff;
      chunkPayload[1] = c & 0xff;
      chunkPayload[2] = (totalChunks >> 8) & 0xff;
      chunkPayload[3] = totalChunks & 0xff;
      chunkPayload.set(slice, 4);

      const dataBits = FrameEncoder.encodePacketToBits(chunkPayload, curSeq & 0xff, useFEC, PacketType.FILE_DATA);
      packets.push({
        seq: curSeq & 0xff,
        packetType: PacketType.FILE_DATA,
        bits: dataBits,
        description: `分卷 [${c + 1}/${totalChunks}] (${slice.length} 字节)`,
        payload: chunkPayload,
      });
      curSeq++;
    }

    // 3. FILE_END packet
    const endMeta = JSON.stringify({
      name: filename,
      size: fileBytes.length,
      crc: CRC16.compute(fileBytes),
    });
    const endPayload = new TextEncoder().encode(endMeta);
    const endBits = FrameEncoder.encodePacketToBits(endPayload, curSeq & 0xff, useFEC, PacketType.FILE_END);
    packets.push({
      seq: curSeq & 0xff,
      packetType: PacketType.FILE_END,
      bits: endBits,
      description: `文件传输结束标记: ${filename}`,
      payload: endPayload,
    });

    return packets;
  }
}

// ============================================================================
// 4.2. FILE ASSEMBLER (RECEIVER ACCUMULATOR)
// ============================================================================
export interface AssembledFile {
  name: string;
  size: number;
  data: Uint8Array;
  mime: string;
  crcValid: boolean;
  receivedChunks: number;
  totalChunks: number;
  timestamp: number;
  blobUrl?: string;
  textPreview?: string;
}

export interface FileProgress {
  name: string;
  receivedChunks: number;
  totalChunks: number;
  receivedBytes: number;
  totalBytes: number;
  percent: number;
  status: 'receiving' | 'completed' | 'corrupted';
}

export class FileAssembler {
  private activeTransfer: {
    name: string;
    size: number;
    totalChunks: number;
    mime: string;
    chunks: Map<number, Uint8Array>;
    expectedCrc?: number;
    startTime: number;
  } | null = null;

  public onProgress?: (progress: FileProgress) => void;
  public onComplete?: (file: AssembledFile) => void;

  public processPacket(packet: DecodedPacket): AssembledFile | null {
    if (!packet.crcValid) return null;

    if (packet.packetType === PacketType.FILE_START && packet.fileMeta) {
      this.activeTransfer = {
        name: packet.fileMeta.name,
        size: packet.fileMeta.size,
        totalChunks: packet.fileMeta.chunks,
        mime: packet.fileMeta.mime || 'application/octet-stream',
        chunks: new Map(),
        startTime: Date.now(),
      };

      if (this.onProgress) {
        this.onProgress({
          name: this.activeTransfer.name,
          receivedChunks: 0,
          totalChunks: this.activeTransfer.totalChunks,
          receivedBytes: 0,
          totalBytes: this.activeTransfer.size,
          percent: 0,
          status: 'receiving',
        });
      }
      return null;
    }

    if (packet.packetType === PacketType.FILE_DATA && packet.fileMeta && packet.fileMeta.chunkData) {
      if (!this.activeTransfer) {
        this.activeTransfer = {
          name: `received_${Date.now()}.bin`,
          size: 0,
          totalChunks: packet.fileMeta.totalChunks || 1,
          mime: 'application/octet-stream',
          chunks: new Map(),
          startTime: Date.now(),
        };
      }

      const chunkIdx = packet.fileMeta.chunkIdx ?? 0;
      this.activeTransfer.chunks.set(chunkIdx, packet.fileMeta.chunkData);

      let bytesReceived = 0;
      for (const data of this.activeTransfer.chunks.values()) {
        bytesReceived += data.length;
      }

      const totalChunks = this.activeTransfer.totalChunks;
      const receivedChunks = this.activeTransfer.chunks.size;
      const percent = Math.min(100, Math.round((receivedChunks / totalChunks) * 100));

      if (this.onProgress) {
        this.onProgress({
          name: this.activeTransfer.name,
          receivedChunks,
          totalChunks,
          receivedBytes: bytesReceived,
          totalBytes: this.activeTransfer.size || bytesReceived,
          percent,
          status: receivedChunks >= totalChunks ? 'completed' : 'receiving',
        });
      }

      if (receivedChunks >= totalChunks) {
        return this.finalizeFile();
      }
      return null;
    }

    if (packet.packetType === PacketType.FILE_END && this.activeTransfer) {
      if (packet.fileMeta && packet.fileMeta.crc !== undefined) {
        this.activeTransfer.expectedCrc = packet.fileMeta.crc;
      }
      return this.finalizeFile();
    }

    return null;
  }

  private finalizeFile(): AssembledFile | null {
    if (!this.activeTransfer) return null;

    const { name, size, totalChunks, mime, chunks } = this.activeTransfer;
    let totalLen = 0;
    for (let c = 0; c < totalChunks; c++) {
      const chunk = chunks.get(c);
      if (chunk) totalLen += chunk.length;
    }

    const fullData = new Uint8Array(totalLen);
    let offset = 0;
    for (let c = 0; c < totalChunks; c++) {
      const chunk = chunks.get(c);
      if (chunk) {
        fullData.set(chunk, offset);
        offset += chunk.length;
      }
    }

    const actualCrc = CRC16.compute(fullData);
    const crcValid = this.activeTransfer.expectedCrc !== undefined ? this.activeTransfer.expectedCrc === actualCrc : true;

    let blobUrl: string | undefined;
    try {
      if (typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
        const blob = new Blob([fullData], { type: mime });
        blobUrl = URL.createObjectURL(blob);
      }
    } catch {}

    let textPreview: string | undefined;
    try {
      if (mime.includes('text') || mime.includes('json') || mime.includes('csv') || mime.includes('xml')) {
        textPreview = new TextDecoder('utf-8').decode(fullData.subarray(0, 500));
      }
    } catch {}

    const assembled: AssembledFile = {
      name,
      size: fullData.length,
      data: fullData,
      mime,
      crcValid,
      receivedChunks: chunks.size,
      totalChunks,
      timestamp: Date.now(),
      blobUrl,
      textPreview,
    };

    if (this.onComplete) {
      this.onComplete(assembled);
    }

    this.activeTransfer = null;
    return assembled;
  }
}

// ============================================================================
// 5. AUDIO MODULATOR: Continuous-Phase FSK (CPFSK)
// ============================================================================
export class FSKModulator {
  /**
   * Modulates bitstream into continuous-phase FSK Float32Array audio samples.
   * Smoothly applies envelope at start and end to eliminate acoustic pop/click.
   */
  static modulate(bits: number[], config: ModemConfig): Float32Array {
    const { sampleRate, baudRate, markFreq, spaceFreq, amplitude } = config;
    const samplesPerSymbol = Math.round(sampleRate / baudRate);
    const totalSamples = bits.length * samplesPerSymbol + Math.round(sampleRate * 0.08); // +80ms lead/trail guard
    const output = new Float32Array(totalSamples);

    let phase = 0;
    const twoPi = 2 * Math.PI;
    const leadGuardSamples = Math.round(sampleRate * 0.04); // 40ms lead silence

    let sampleIdx = leadGuardSamples;

    for (let bitIdx = 0; bitIdx < bits.length; bitIdx++) {
      const bit = bits[bitIdx];
      const freq = bit === 1 ? markFreq : spaceFreq;
      const phaseIncrement = (twoPi * freq) / sampleRate;

      for (let s = 0; s < samplesPerSymbol; s++) {
        output[sampleIdx++] = amplitude * Math.sin(phase);
        phase += phaseIncrement;
        if (phase > twoPi) phase -= twoPi;
      }
    }

    // Apply smooth Tukey/Hann windowing on start and end
    const rampSamples = Math.min(Math.round(sampleRate * 0.02), leadGuardSamples);
    for (let i = 0; i < rampSamples; i++) {
      const env = 0.5 * (1 - Math.cos((Math.PI * i) / rampSamples));
      const headIdx = leadGuardSamples - rampSamples + i;
      if (headIdx >= 0) output[headIdx] *= env;
    }
    const tailStart = sampleIdx;
    for (let i = 0; i < rampSamples && tailStart + i < totalSamples; i++) {
      const env = 0.5 * (1 + Math.cos((Math.PI * i) / rampSamples));
      output[tailStart + i] *= env;
    }

    return output;
  }
}

// ============================================================================
// 6. CONTINUOUS STREAMING FSK DEMODULATOR: DPLL + Adaptive Equalizer
// ============================================================================
export class FSKDemodulator {
  public config: ModemConfig;
  public samplesPerSymbol: number;

  // Quadrature sin/cos reference tables
  private markCosTable: Float32Array;
  private markSinTable: Float32Array;
  private spaceCosTable: Float32Array;
  private spaceSinTable: Float32Array;

  // Streaming sample buffer (retains unconsumed audio samples across chunk boundaries)
  private sampleBuffer: number[] = [];

  // Persistent streaming bit buffer
  private bitBuffer: number[] = [];

  // Symbol clock recovery & tracking state (DPLL)
  private clockPhase: number = 0;
  private lastDiscriminator: number = 0;

  // Adaptive channel equalizer (balances 1200Hz vs 2200Hz phone mic gain differences)
  private maxMarkEnergy: number = 0.001;
  private maxSpaceEnergy: number = 0.001;

  // Callbacks
  private onPacketCallback?: (packet: DecodedPacket) => void;
  private onSignalQualityCallback?: (quality: { snrDb: number; markEnergy: number; spaceEnergy: number; rms: number }) => void;

  constructor(config: Partial<ModemConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.samplesPerSymbol = Math.round(this.config.sampleRate / this.config.baudRate);

    const N = this.samplesPerSymbol;
    this.markCosTable = new Float32Array(N);
    this.markSinTable = new Float32Array(N);
    this.spaceCosTable = new Float32Array(N);
    this.spaceSinTable = new Float32Array(N);

    this.rebuildTables();
  }

  public updateConfig(newConfig: Partial<ModemConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.samplesPerSymbol = Math.round(this.config.sampleRate / this.config.baudRate);
    this.rebuildTables();
    this.reset();
  }

  public reset() {
    this.sampleBuffer = [];
    this.bitBuffer = [];
    this.clockPhase = 0;
    this.lastDiscriminator = 0;
    this.maxMarkEnergy = 0.001;
    this.maxSpaceEnergy = 0.001;
  }

  private rebuildTables() {
    const { sampleRate, markFreq, spaceFreq } = this.config;
    const N = this.samplesPerSymbol;
    this.markCosTable = new Float32Array(N);
    this.markSinTable = new Float32Array(N);
    this.spaceCosTable = new Float32Array(N);
    this.spaceSinTable = new Float32Array(N);

    for (let n = 0; n < N; n++) {
      const t = n / sampleRate;
      this.markCosTable[n] = Math.cos(2 * Math.PI * markFreq * t);
      this.markSinTable[n] = Math.sin(2 * Math.PI * markFreq * t);
      this.spaceCosTable[n] = Math.cos(2 * Math.PI * spaceFreq * t);
      this.spaceSinTable[n] = Math.sin(2 * Math.PI * spaceFreq * t);
    }
  }

  public setOnPacket(cb: (packet: DecodedPacket) => void) {
    this.onPacketCallback = cb;
  }

  public setOnSignalQuality(cb: (quality: { snrDb: number; markEnergy: number; spaceEnergy: number; rms: number }) => void) {
    this.onSignalQualityCallback = cb;
  }

  /**
   * Main entrypoint for streaming audio samples.
   * Can accept audio of ANY buffer size (e.g. 512, 1024, 2048, 4096 or full buffers).
   * Maintains continuous phase and symbol tracking across chunk calls.
   */
  public processAudioBuffer(incoming: Float32Array): DecodedPacket[] {
    const packets: DecodedPacket[] = [];
    if (!incoming || incoming.length === 0) return packets;

    // Append incoming samples to continuous stream buffer
    for (let i = 0; i < incoming.length; i++) {
      this.sampleBuffer.push(incoming[i]);
    }

    const N = this.samplesPerSymbol;
    // Step stride: evaluate discriminator every S samples (oversampling by 8x for tight symbol phase sync)
    const S = Math.max(1, Math.floor(N / 8));

    let processedSamples = 0;
    let snrSum = 0;
    let snrSamplesCount = 0;

    // Sliding window matched filter
    while (this.sampleBuffer.length >= N + S) {
      // Calculate matched filter correlation over window [0 .. N-1]
      let markI = 0, markQ = 0;
      let spaceI = 0, spaceQ = 0;
      let sumSq = 0;

      for (let n = 0; n < N; n++) {
        const s = this.sampleBuffer[n];
        sumSq += s * s;
        markI += s * this.markCosTable[n];
        markQ += s * this.markSinTable[n];
        spaceI += s * this.spaceCosTable[n];
        spaceQ += s * this.spaceSinTable[n];
      }

      const rms = Math.sqrt(sumSq / N);
      const markE = (markI * markI + markQ * markQ) / (N * N);
      const spaceE = (spaceI * spaceI + spaceQ * spaceQ) / (N * N);
      const totalCarrierEnergy = markE + spaceE;

      // Squelch threshold: if audio level is too quiet (< -40 dBFS), skip bit decisions
      if (rms < 0.004 || totalCarrierEnergy < 1e-7) {
        // In silence, slowly decay equalizer references
        this.maxMarkEnergy = Math.max(0.001, this.maxMarkEnergy * 0.99);
        this.maxSpaceEnergy = Math.max(0.001, this.maxSpaceEnergy * 0.99);

        // Advance sample buffer by S
        this.sampleBuffer.splice(0, S);
        processedSamples += S;
        this.clockPhase = 0;
        continue;
      }

      // Dynamic Equalization: phone microphones have high-frequency roll-off (2200Hz is attenuated compared to 1200Hz)
      // Track peak energies and normalize
      this.maxMarkEnergy = Math.max(markE, this.maxMarkEnergy * 0.998);
      this.maxSpaceEnergy = Math.max(spaceE, this.maxSpaceEnergy * 0.998);

      const normMarkE = markE / Math.max(1e-6, this.maxMarkEnergy);
      const normSpaceE = spaceE / Math.max(1e-6, this.maxSpaceEnergy);

      // Discriminator metric: >0 = Mark (1), <0 = Space (0)
      const discriminator = normMarkE - normSpaceE;

      // Local SNR calculation
      const higherE = Math.max(normMarkE, normSpaceE);
      const lowerE = Math.min(normMarkE, normSpaceE) + 1e-6;
      const localSnrDb = Math.min(45, Math.max(0, 10 * Math.log10(higherE / lowerE)));
      snrSum += localSnrDb;
      snrSamplesCount++;

      // Symbol Clock Recovery (DPLL):
      // A zero-crossing of discriminator indicates a transition between Mark and Space (symbol boundary)
      if (this.lastDiscriminator * discriminator < 0) {
        // Transition detected!
        // Ideal transition phase is 0. Calculate phase error:
        let phaseError = this.clockPhase;
        if (phaseError > N / 2) {
          phaseError -= N;
        }
        // Nudge DPLL clock phase towards 0 (loop gain alpha = 0.35)
        this.clockPhase -= Math.round(phaseError * 0.35);
      }
      this.lastDiscriminator = discriminator;

      // Advance symbol clock
      const prevClock = this.clockPhase;
      this.clockPhase += S;

      // When the clock phase passes through the middle of the symbol (N/2, optimal eye opening):
      // Sample the bit!
      if (prevClock < N / 2 && this.clockPhase >= N / 2) {
        const bit = discriminator >= 0 ? 1 : 0;
        this.bitBuffer.push(bit);

        // Limit bit buffer length to prevent memory leaks (retain sufficient depth for large frames up to 256 bytes with FEC)
        if (this.bitBuffer.length > 20000) {
          this.bitBuffer.splice(0, 5000);
        }
      }

      // Symbol period wrap-around
      if (this.clockPhase >= N) {
        this.clockPhase -= N;
      }

      // Consume S samples from audio buffer
      this.sampleBuffer.splice(0, S);
      processedSamples += S;
    }

    if (snrSamplesCount > 0 && this.onSignalQualityCallback) {
      this.onSignalQualityCallback({
        snrDb: Math.round(snrSum / snrSamplesCount),
        markEnergy: this.maxMarkEnergy,
        spaceEnergy: this.maxSpaceEnergy,
        rms: Math.sqrt(this.maxMarkEnergy + this.maxSpaceEnergy),
      });
    }

    // Parse packets from bit buffer
    const decoded = this.parsePacketsFromBitBuffer();
    for (const pkt of decoded) {
      packets.push(pkt);
      if (this.onPacketCallback) this.onPacketCallback(pkt);
    }

    return packets;
  }

  /**
   * Parses complete frames from the streaming bit buffer.
   * Tolerates 1-bit error in the 16-bit sync word to avoid dropping frames on minor clicks.
   */
  public parsePacketsFromBitBuffer(): DecodedPacket[] {
    const packets: DecodedPacket[] = [];
    let i = 0;

    while (i <= this.bitBuffer.length - 32) {
      // Find sync word 0xD391 with up to 1-bit error tolerance
      let diff = 0;
      for (let s = 0; s < 16; s++) {
        if (this.bitBuffer[i + s] !== SYNC_BITS[s]) {
          diff++;
          if (diff > 1) break;
        }
      }

      if (diff > 1) {
        i++;
        continue;
      }

      // Found potential sync word at index i!
      let cursor = i + 16;
      let fecCorrections = 0;

      // Check if header bits are available (3 bytes * 14 bits = 42 bits)
      if (cursor + 42 > this.bitBuffer.length) {
        // Wait for more incoming bits in next audio chunk
        break;
      }

      // Decode Header [seq, len, flags]
      const headerBytes: number[] = [];
      let headerCorrupt = false;
      for (let b = 0; b < 3; b++) {
        let highCode = 0, lowCode = 0;
        for (let bit = 0; bit < 7; bit++) highCode = (highCode << 1) | this.bitBuffer[cursor++];
        for (let bit = 0; bit < 7; bit++) lowCode = (lowCode << 1) | this.bitBuffer[cursor++];
        const res = Hamming74.decodeByte(highCode, lowCode);
        headerBytes.push(res.byte);
        fecCorrections += res.corrections;
      }

      const [seq, payloadLen, flags] = headerBytes;
      const useFEC = (flags & 0x01) === 0x01;

      // Validate header sanity (support chunk payloads up to 240 bytes)
      if (payloadLen > 250) {
        // False positive sync word or corrupted length! Skip 1 bit and keep searching
        i++;
        continue;
      }

      const payloadBits = useFEC ? payloadLen * 14 : payloadLen * 8;
      const crcBits = 28; // CRC 2 bytes encoded in 4 Hamming codewords = 28 bits

      // Check if full payload + CRC have arrived
      if (cursor + payloadBits + crcBits > this.bitBuffer.length) {
        // Frame still in flight; wait for the rest of the audio samples
        break;
      }

      // Decode Payload
      const payload = new Uint8Array(payloadLen);
      for (let p = 0; p < payloadLen; p++) {
        if (useFEC) {
          let highCode = 0, lowCode = 0;
          for (let bit = 0; bit < 7; bit++) highCode = (highCode << 1) | this.bitBuffer[cursor++];
          for (let bit = 0; bit < 7; bit++) lowCode = (lowCode << 1) | this.bitBuffer[cursor++];
          const res = Hamming74.decodeByte(highCode, lowCode);
          payload[p] = res.byte;
          fecCorrections += res.corrections;
        } else {
          let rawByte = 0;
          for (let bit = 0; bit < 8; bit++) rawByte = (rawByte << 1) | this.bitBuffer[cursor++];
          payload[p] = rawByte;
        }
      }

      // Decode CRC-16
      const crcCodewords: number[] = [];
      for (let c = 0; c < 4; c++) {
        let code = 0;
        for (let bit = 0; bit < 7; bit++) code = (code << 1) | this.bitBuffer[cursor++];
        crcCodewords.push(code);
      }
      const crcHighRes = Hamming74.decodeByte(crcCodewords[0], crcCodewords[1]);
      const crcLowRes = Hamming74.decodeByte(crcCodewords[2], crcCodewords[3]);
      fecCorrections += crcHighRes.corrections + crcLowRes.corrections;
      const receivedCrc = ((crcHighRes.byte & 0xff) << 8) | (crcLowRes.byte & 0xff);

      // Verify Checksum
      const dataForCrc = new Uint8Array(3 + payload.length);
      dataForCrc[0] = seq;
      dataForCrc[1] = payloadLen;
      dataForCrc[2] = flags;
      dataForCrc.set(payload, 3);
      const expectedCrc = CRC16.compute(dataForCrc);

      const crcValid = (receivedCrc === expectedCrc);

      const packetType: PacketType = (flags >> 1) & 0x07;
      let text: string | undefined;
      let fileMeta: FileMeta | undefined;

      if (packetType === PacketType.FILE_START) {
        try {
          const str = new TextDecoder('utf-8').decode(payload);
          const parsed = JSON.parse(str);
          fileMeta = {
            name: parsed.name,
            size: parsed.size,
            chunks: parsed.chunks,
            mime: parsed.mime || 'application/octet-stream',
          };
          text = `[文件传输开始] ${parsed.name} (${parsed.size} 字节, ${parsed.chunks} 分卷)`;
        } catch {
          text = '[文件传输开始] (元数据解析失败)';
        }
      } else if (packetType === PacketType.FILE_DATA) {
        if (payload.length >= 4) {
          const chunkIdx = (payload[0] << 8) | payload[1];
          const totalChunks = (payload[2] << 8) | payload[3];
          const chunkData = payload.subarray(4);
          fileMeta = {
            name: '',
            size: 0,
            chunks: totalChunks,
            chunkIdx,
            totalChunks,
            chunkData,
          };
          text = `[文件分卷 #${chunkIdx + 1}/${totalChunks}] ${chunkData.length} 字节`;
        }
      } else if (packetType === PacketType.FILE_END) {
        try {
          const str = new TextDecoder('utf-8').decode(payload);
          const parsed = JSON.parse(str);
          fileMeta = {
            name: parsed.name,
            size: parsed.size,
            chunks: 0,
            crc: parsed.crc,
          };
          text = `[文件传输结束] ${parsed.name}`;
        } catch {
          text = '[文件传输结束]';
        }
      } else {
        try {
          text = new TextDecoder('utf-8', { fatal: false }).decode(payload);
        } catch {
          text = undefined;
        }
      }

      packets.push({
        seq,
        payload,
        text,
        packetType,
        fileMeta,
        crcValid,
        crcExpected: expectedCrc,
        crcReceived: receivedCrc,
        fecCorrections,
        timestamp: Date.now(),
      });

      // Advance search cursor past this decoded packet
      i = cursor;
    }

    // Prune consumed bits from the front of the bit buffer
    if (i > 0) {
      this.bitBuffer.splice(0, i);
    }

    return packets;
  }
}
