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
export const PREAMBLE_BITS = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]; // 16 bits
export const SYNC_WORD = 0xd391; // 16-bit Barker-like sync sequence: 11010011 10010001
export const SYNC_BITS = [1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1]; // 16 bits

export interface ModemConfig {
  sampleRate: number;      // e.g. 44100, 48000
  baudRate: number;        // e.g. 100, 150, 200, 300 baud
  markFreq: number;        // bit '1' frequency (e.g. 1200 Hz)
  spaceFreq: number;       // bit '0' frequency (e.g. 2200 Hz)
  amplitude: number;       // 0.0 - 1.0 (recommended 0.7 to avoid DAC/Mic clipping)
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

export interface PacketHeader {
  seq: number;       // 0-255 packet sequence number
  len: number;       // Payload length in bytes
  flags: number;     // bit 0: FEC enabled
}

export interface DecodedPacket {
  seq: number;
  payload: Uint8Array;
  text?: string;
  crcValid: boolean;
  crcExpected: number;
  crcReceived: number;
  fecCorrections: number;
  snrDb?: number;
  timestamp: number;
}

// ============================================================================
// 4. FRAME ENCODER
// ============================================================================
export class FrameEncoder {
  /**
   * Builds the complete bitstream for a payload (Preamble + Sync + Header + Payload + CRC)
   */
  static encodePacketToBits(payload: Uint8Array, seq: number, useFEC: boolean): number[] {
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
    const flags = (useFEC ? 0x01 : 0x00);
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

    // 8. Flush guard bits (4 bits of 1s)
    bits.push(1, 1, 1, 1);

    return bits;
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
    const totalSamples = bits.length * samplesPerSymbol + Math.round(sampleRate * 0.05); // +50ms lead/trail guard
    const output = new Float32Array(totalSamples);

    let phase = 0;
    const twoPi = 2 * Math.PI;
    const leadGuardSamples = Math.round(sampleRate * 0.02); // 20ms lead

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
    const rampSamples = Math.min(Math.round(sampleRate * 0.015), leadGuardSamples);
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
// 6. AUDIO DEMODULATOR: Matched Quadrature I/Q Filter + Timing Recovery
// ============================================================================
export class FSKDemodulator {
  private config: ModemConfig;
  private samplesPerSymbol: number;

  // Correlator sliding buffers
  private markCosTable: Float32Array;
  private markSinTable: Float32Array;
  private spaceCosTable: Float32Array;
  private spaceSinTable: Float32Array;

  // Stream state
  private rawBitBuffer: number[] = [];
  private onPacketCallback?: (packet: DecodedPacket) => void;
  private onSignalQualityCallback?: (quality: { snrDb: number; markEnergy: number; spaceEnergy: number; rms: number }) => void;

  constructor(config: Partial<ModemConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.samplesPerSymbol = Math.round(this.config.sampleRate / this.config.baudRate);

    // Precalculate quadrature sine/cosine tables for matched filter correlation
    this.markCosTable = new Float32Array(this.samplesPerSymbol);
    this.markSinTable = new Float32Array(this.samplesPerSymbol);
    this.spaceCosTable = new Float32Array(this.samplesPerSymbol);
    this.spaceSinTable = new Float32Array(this.samplesPerSymbol);

    this.rebuildTables();
  }

  public updateConfig(newConfig: Partial<ModemConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.samplesPerSymbol = Math.round(this.config.sampleRate / this.config.baudRate);
    this.rebuildTables();
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
   * Demodulates an entire audio buffer or batch.
   * Performs matched filter correlation across sliding symbol windows.
   */
  public processAudioBuffer(samples: Float32Array): DecodedPacket[] {
    const packets: DecodedPacket[] = [];
    const N = this.samplesPerSymbol;
    if (samples.length < N * 2) return packets;

    // Calculate overall RMS for silence/carrier detection
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSq += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSq / samples.length);

    // If signal is virtually dead silence (e.g. cable unplugged), skip
    if (rms < 0.005) {
      if (this.onSignalQualityCallback) {
        this.onSignalQualityCallback({ snrDb: 0, markEnergy: 0, spaceEnergy: 0, rms });
      }
      return packets;
    }

    // Step through audio in symbol-sized strides
    // For optimal symbol boundary alignment, we test preamble correlation
    const detectedBits: number[] = [];
    let avgSnrDb = 0;
    let symbolCount = 0;

    // Coarse symbol sweep with half-symbol oversampling or peak energy search
    // To find the optimal offset phase (0..N-1) using the 16-bit preamble:
    const bestOffset = this.findSymbolAlignment(samples);

    for (let offset = bestOffset; offset + N <= samples.length; offset += N) {
      let markI = 0, markQ = 0;
      let spaceI = 0, spaceQ = 0;

      for (let n = 0; n < N; n++) {
        const val = samples[offset + n];
        markI += val * this.markCosTable[n];
        markQ += val * this.markSinTable[n];
        spaceI += val * this.spaceCosTable[n];
        spaceQ += val * this.spaceSinTable[n];
      }

      const markEnergy = (markI * markI + markQ * markQ) / (N * N);
      const spaceEnergy = (spaceI * spaceI + spaceQ * spaceQ) / (N * N);

      // Decision rule: mark vs space
      const bit = markEnergy >= spaceEnergy ? 1 : 0;
      detectedBits.push(bit);

      // Compute local SNR approximation
      const activeE = Math.max(markEnergy, spaceEnergy);
      const inactiveE = Math.min(markEnergy, spaceEnergy);
      const snr = inactiveE > 0 ? 10 * Math.log10(activeE / inactiveE) : 30;
      avgSnrDb += Math.min(Math.max(snr, 0), 40);
      symbolCount++;
    }

    if (symbolCount > 0 && this.onSignalQualityCallback) {
      this.onSignalQualityCallback({
        snrDb: avgSnrDb / symbolCount,
        markEnergy: 1,
        spaceEnergy: 1,
        rms
      });
    }

    // Parse packets from detected bit stream
    const decoded = this.parsePacketsFromBits(detectedBits);
    for (const pkt of decoded) {
      packets.push(pkt);
      if (this.onPacketCallback) this.onPacketCallback(pkt);
    }

    return packets;
  }

  /**
   * Finds the best symbol phase offset (0..samplesPerSymbol-1) by maximizing
   * correlation with the known preamble sequence.
   */
  private findSymbolAlignment(samples: Float32Array): number {
    const N = this.samplesPerSymbol;
    const testOffsets = [0, Math.floor(N * 0.25), Math.floor(N * 0.5), Math.floor(N * 0.75)];
    let bestOffset = 0;
    let maxDiffEnergy = -1;

    for (const offset of testOffsets) {
      let diffSum = 0;
      const symbolsToCheck = Math.min(16, Math.floor((samples.length - offset) / N));
      if (symbolsToCheck < 8) continue;

      for (let s = 0; s < symbolsToCheck; s++) {
        let markI = 0, markQ = 0, spaceI = 0, spaceQ = 0;
        const base = offset + s * N;
        for (let n = 0; n < N; n++) {
          const val = samples[base + n];
          markI += val * this.markCosTable[n];
          markQ += val * this.markSinTable[n];
          spaceI += val * this.spaceCosTable[n];
          spaceQ += val * this.spaceSinTable[n];
        }
        const markE = markI * markI + markQ * markQ;
        const spaceE = spaceI * spaceI + spaceQ * spaceQ;
        diffSum += Math.abs(markE - spaceE);
      }

      if (diffSum > maxDiffEnergy) {
        maxDiffEnergy = diffSum;
        bestOffset = offset;
      }
    }

    return bestOffset;
  }

  /**
   * Searches for Sync Word and decodes frames from bitstream.
   */
  public parsePacketsFromBits(bits: number[]): DecodedPacket[] {
    const packets: DecodedPacket[] = [];
    let i = 0;

    while (i <= bits.length - 32) {
      // Find sync word pattern 0xD391
      let syncMatch = true;
      for (let s = 0; s < 16; s++) {
        if (bits[i + s] !== SYNC_BITS[s]) {
          syncMatch = false;
          break;
        }
      }

      if (!syncMatch) {
        i++;
        continue;
      }

      // Found Sync Word at position i!
      let cursor = i + 16;
      let fecCorrections = 0;

      // 1. Decode Header (3 bytes: seq, len, flags)
      // Each header byte is encoded with two 7-bit Hamming codewords (14 bits)
      if (cursor + 3 * 14 > bits.length) {
        break; // Not enough bits for header
      }

      const headerBytes: number[] = [];
      for (let b = 0; b < 3; b++) {
        let highCode = 0;
        for (let bit = 0; bit < 7; bit++) highCode = (highCode << 1) | bits[cursor++];
        let lowCode = 0;
        for (let bit = 0; bit < 7; bit++) lowCode = (lowCode << 1) | bits[cursor++];

        const { byte, corrections } = Hamming74.decodeByte(highCode, lowCode);
        headerBytes.push(byte);
        fecCorrections += corrections;
      }

      const [seq, payloadLen, flags] = headerBytes;
      const useFEC = (flags & 0x01) === 0x01;

      // Sanity check length
      if (payloadLen > 128) {
        // False positive sync word or corrupted length
        i++;
        continue;
      }

      // 2. Decode Payload
      const bitsNeededForPayload = useFEC ? payloadLen * 14 : payloadLen * 8;
      const bitsNeededForCrc = 4 * 7; // CRC (2 bytes) = 4 codewords = 28 bits

      if (cursor + bitsNeededForPayload + bitsNeededForCrc > bits.length) {
        break; // Incomplete packet in this chunk
      }

      const payload = new Uint8Array(payloadLen);
      for (let p = 0; p < payloadLen; p++) {
        if (useFEC) {
          let highCode = 0;
          for (let bit = 0; bit < 7; bit++) highCode = (highCode << 1) | bits[cursor++];
          let lowCode = 0;
          for (let bit = 0; bit < 7; bit++) lowCode = (lowCode << 1) | bits[cursor++];

          const { byte, corrections } = Hamming74.decodeByte(highCode, lowCode);
          payload[p] = byte;
          fecCorrections += corrections;
        } else {
          let rawByte = 0;
          for (let bit = 0; bit < 8; bit++) rawByte = (rawByte << 1) | bits[cursor++];
          payload[p] = rawByte;
        }
      }

      // 3. Decode CRC-16
      const crcCodewords: number[] = [];
      for (let c = 0; c < 4; c++) {
        let code = 0;
        for (let bit = 0; bit < 7; bit++) code = (code << 1) | bits[cursor++];
        crcCodewords.push(code);
      }
      const crcHighRes = Hamming74.decodeByte(crcCodewords[0], crcCodewords[1]);
      const crcLowRes = Hamming74.decodeByte(crcCodewords[2], crcCodewords[3]);
      fecCorrections += crcHighRes.corrections + crcLowRes.corrections;
      const receivedCrc = ((crcHighRes.byte & 0xff) << 8) | (crcLowRes.byte & 0xff);

      // 4. Verify Checksum
      const dataForCrc = new Uint8Array(3 + payload.length);
      dataForCrc[0] = seq;
      dataForCrc[1] = payloadLen;
      dataForCrc[2] = flags;
      dataForCrc.set(payload, 3);
      const expectedCrc = CRC16.compute(dataForCrc);

      const crcValid = receivedCrc === expectedCrc;

      // Decode payload to string if UTF-8
      let text: string | undefined;
      try {
        text = new TextDecoder('utf-8', { fatal: false }).decode(payload);
      } catch {
        text = undefined;
      }

      packets.push({
        seq,
        payload,
        text,
        crcValid,
        crcExpected: expectedCrc,
        crcReceived: receivedCrc,
        fecCorrections,
        timestamp: Date.now(),
      });

      // Advance search cursor past this packet
      i = cursor;
    }

    return packets;
  }
}
