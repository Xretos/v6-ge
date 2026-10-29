/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Hamming74,
  CRC16,
  FrameEncoder,
  FSKModulator,
  FSKDemodulator,
  FileChunker,
  FileAssembler,
  PacketType,
  DEFAULT_CONFIG,
} from './fsk';

test('Hamming(7,4): roundtrip of all 16 nibbles without errors', () => {
  for (let nibble = 0; nibble < 16; nibble++) {
    const codeword = Hamming74.encodeNibble(nibble);
    const decoded = Hamming74.decodeNibble(codeword);
    assert.equal(decoded.nibble, nibble, `Failed for nibble ${nibble}`);
    assert.equal(decoded.corrected, false);
    assert.equal(decoded.errorBitIndex, -1);
  }
});

test('Hamming(7,4): single-bit error correction for all 7 bit positions', () => {
  const testNibble = 0b1011; // 11
  const codeword = Hamming74.encodeNibble(testNibble);

  for (let shift = 0; shift < 7; shift++) {
    const corruptedCodeword = codeword ^ (1 << shift);
    const decoded = Hamming74.decodeNibble(corruptedCodeword);
    assert.equal(decoded.nibble, testNibble, `Failed to correct flipped bit at shift ${shift}`);
    assert.equal(decoded.corrected, true);
  }
});

test('Hamming(7,4): byte roundtrip with 1 error per nibble', () => {
  const originalByte = 0x8a; // 1000 1010
  const [highCode, lowCode] = Hamming74.encodeByte(originalByte);

  // Corrupt one bit in high code, one in low code
  const corruptedHigh = highCode ^ (1 << 3);
  const corruptedLow = lowCode ^ (1 << 5);

  const { byte, corrections } = Hamming74.decodeByte(corruptedHigh, corruptedLow);
  assert.equal(byte, originalByte);
  assert.equal(corrections, 2);
});

test('CRC16: calculation and verification', () => {
  const data = new TextEncoder().encode('HELLO AUDIO FSK');
  const crc = CRC16.compute(data);
  assert.ok(crc >= 0 && crc <= 0xffff);
  assert.equal(CRC16.verify(data, crc), true);

  // Corrupt data
  const corrupted = new Uint8Array(data);
  corrupted[0] ^= 0x01;
  assert.equal(CRC16.verify(corrupted, crc), false);
});

test('End-to-End Modulation and Demodulation at 100 baud (48000 Hz)', () => {
  const message = 'TEST-FSK-100BPS';
  const payload = new TextEncoder().encode(message);
  const config = { ...DEFAULT_CONFIG, sampleRate: 48000, baudRate: 100, useFEC: true };

  // 1. Encode packet to bits
  const bits = FrameEncoder.encodePacketToBits(payload, 42, true);
  assert.ok(bits.length > 50);

  // 2. Modulate to continuous-phase audio samples
  const audioSamples = FSKModulator.modulate(bits, config);
  assert.ok(audioSamples.length > 0);

  // 3. Demodulate audio
  const demodulator = new FSKDemodulator(config);
  const packets = demodulator.processAudioBuffer(audioSamples);

  assert.equal(packets.length, 1, 'Should decode exactly one packet');
  assert.equal(packets[0].seq, 42);
  assert.equal(packets[0].crcValid, true, 'CRC must be valid');
  assert.equal(packets[0].text, message);
});

test('End-to-End Modulation and Demodulation at 44100 Hz adaptive sample rate', () => {
  const message = 'ADAPTIVE-44.1KHZ';
  const payload = new TextEncoder().encode(message);
  const config = { ...DEFAULT_CONFIG, sampleRate: 44100, baudRate: 100, useFEC: true };

  const bits = FrameEncoder.encodePacketToBits(payload, 7, true);
  const audioSamples = FSKModulator.modulate(bits, config);

  const demodulator = new FSKDemodulator(config);
  const packets = demodulator.processAudioBuffer(audioSamples);

  assert.equal(packets.length, 1);
  assert.equal(packets[0].crcValid, true);
  assert.equal(packets[0].text, message);
});

test('Streaming audio in realistic small chunks (1024 samples) with leading silence', () => {
  const message = 'STREAMING-CHUNK-TEST';
  const payload = new TextEncoder().encode(message);
  const config = { ...DEFAULT_CONFIG, sampleRate: 48000, baudRate: 100, useFEC: true };

  const bits = FrameEncoder.encodePacketToBits(payload, 88, true);
  const modulated = FSKModulator.modulate(bits, config);

  // Prepend 3500 samples of quiet line noise / silence (simulating real mic stream before transmission starts)
  const total = 3500 + modulated.length + 2000;
  const fullAudio = new Float32Array(total);
  for (let i = 0; i < 3500; i++) fullAudio[i] = (Math.random() - 0.5) * 0.001; // low noise
  fullAudio.set(modulated, 3500);
  for (let i = 3500 + modulated.length; i < total; i++) fullAudio[i] = (Math.random() - 0.5) * 0.001;

  // Stream in 1024-sample chunks (like Web Audio onaudioprocess)
  const demodulator = new FSKDemodulator(config);
  const allDecoded: any[] = [];
  const CHUNK_SIZE = 1024;

  for (let offset = 0; offset < fullAudio.length; offset += CHUNK_SIZE) {
    const chunk = fullAudio.subarray(offset, Math.min(fullAudio.length, offset + CHUNK_SIZE));
    const pkts = demodulator.processAudioBuffer(chunk);
    allDecoded.push(...pkts);
  }

  assert.equal(allDecoded.length, 1, 'Should decode packet even when streamed in 1024 chunks');
  assert.equal(allDecoded[0].seq, 88);
  assert.equal(allDecoded[0].crcValid, true);
  assert.equal(allDecoded[0].text, message);
});

test('FileTransfer: chunking, FSK modulation, streaming demodulation and assembly', () => {
  const filename = 'sensor_data.json';
  const fileContent = JSON.stringify({
    sensor: 'AudioJack-Modem',
    reading: 42.5,
    status: 'OK',
    notes: 'Testing multi-chunk file transfer over 3.5mm FSK audio cable!',
  });
  const fileBytes = new TextEncoder().encode(fileContent);
  const config = { ...DEFAULT_CONFIG, sampleRate: 48000, baudRate: 200, useFEC: true };

  // 1. Split file into chunks of 32 bytes
  const filePackets = FileChunker.createFilePackets(filename, fileBytes, 'application/json', 32, true, 1);
  assert.ok(filePackets.length >= 3, 'Should produce at least FILE_START, FILE_DATA, and FILE_END');

  // 2. Modulate each packet into audio and concatenate with 50ms guard pauses
  const guardSamples = Math.round(config.sampleRate * 0.05);
  let totalLen = 0;
  const audioChunks: Float32Array[] = [];

  for (const p of filePackets) {
    const audio = FSKModulator.modulate(p.bits, config);
    audioChunks.push(audio);
    totalLen += audio.length + guardSamples;
  }

  const fullAudio = new Float32Array(totalLen);
  let writeOffset = 0;
  for (const audio of audioChunks) {
    fullAudio.set(audio, writeOffset);
    writeOffset += audio.length + guardSamples;
  }

  // 3. Demodulate and assemble using FileAssembler
  const demodulator = new FSKDemodulator(config);
  const assembler = new FileAssembler();
  let completedFile: any = null;

  assembler.onComplete = (file) => {
    completedFile = file;
  };

  // Stream in 1024-sample chunks
  const CHUNK_SIZE = 1024;
  for (let offset = 0; offset < fullAudio.length; offset += CHUNK_SIZE) {
    const slice = fullAudio.subarray(offset, Math.min(fullAudio.length, offset + CHUNK_SIZE));
    const pkts = demodulator.processAudioBuffer(slice);
    for (const pkt of pkts) {
      assembler.processPacket(pkt);
    }
  }

  assert.ok(completedFile !== null, 'FileAssembler should emit completed file');
  assert.equal(completedFile.name, filename);
  assert.equal(completedFile.size, fileBytes.length);
  assert.equal(completedFile.crcValid, true, 'Reassembled file CRC must match');
  const reconstructedText = new TextDecoder('utf-8').decode(completedFile.data);
  assert.equal(reconstructedText, fileContent);
});

test('10x Turbo Mode: 1000 bps CPFSK orthogonal modulation and demodulation (2000Hz / 3000Hz)', () => {
  const message = 'TURBO-1000BPS-TEST';
  const payload = new TextEncoder().encode(message);
  const config = {
    sampleRate: 48000,
    baudRate: 1000, // 10x speedup
    markFreq: 2000,
    spaceFreq: 3000,
    amplitude: 0.8,
    useFEC: false, // Pure CRC on clean 3.5mm line
  };

  const bits = FrameEncoder.encodePacketToBits(payload, 99, false);
  const audioSamples = FSKModulator.modulate(bits, config);

  const demodulator = new FSKDemodulator(config);
  const packets = demodulator.processAudioBuffer(audioSamples);

  assert.equal(packets.length, 1, 'Should decode packet at 1000 bps');
  assert.equal(packets[0].seq, 99);
  assert.equal(packets[0].crcValid, true);
  assert.equal(packets[0].text, message);
});

test('10x Turbo File Transfer with 128-byte large chunks at 1000 bps', () => {
  const filename = 'large_telemetry.csv';
  const csvData = 'id,timestamp,voltage,current,temperature,status\n' +
    '1,1700000000,3.31,0.045,28.4,NORMAL\n' +
    '2,1700000001,3.30,0.046,28.5,NORMAL\n' +
    '3,1700000002,3.32,0.044,28.6,NORMAL\n' +
    '4,1700000003,3.29,0.047,28.7,NORMAL\n' +
    '5,1700000004,3.31,0.045,28.5,NORMAL\n';
  const fileBytes = new TextEncoder().encode(csvData);
  const config = {
    sampleRate: 48000,
    baudRate: 1000,
    markFreq: 2000,
    spaceFreq: 3000,
    amplitude: 0.8,
    useFEC: false,
  };

  // Chunk with 128 bytes
  const filePackets = FileChunker.createFilePackets(filename, fileBytes, 'text/csv', 128, false, 1);
  assert.ok(filePackets.length >= 3);

  const demodulator = new FSKDemodulator(config);
  const assembler = new FileAssembler();
  let completedFile: any = null;
  assembler.onComplete = (f) => { completedFile = f; };

  for (const p of filePackets) {
    const audio = FSKModulator.modulate(p.bits, config);
    const pkts = demodulator.processAudioBuffer(audio);
    for (const pkt of pkts) {
      assembler.processPacket(pkt);
    }
  }

  assert.ok(completedFile !== null);
  assert.equal(completedFile.name, filename);
  assert.equal(completedFile.size, fileBytes.length);
  assert.equal(completedFile.crcValid, true);
  const reconstructed = new TextDecoder('utf-8').decode(completedFile.data);
  assert.equal(reconstructed, csvData);
});

test('20x Extreme Mode: 2000 bps CPFSK orthogonal modulation and demodulation (2000Hz / 4000Hz)', () => {
  const message = 'EXTREME-2000BPS';
  const payload = new TextEncoder().encode(message);
  const config = {
    sampleRate: 48000,
    baudRate: 2000, // 20x speedup
    markFreq: 2000,
    spaceFreq: 4000,
    amplitude: 0.8,
    useFEC: false,
  };

  const bits = FrameEncoder.encodePacketToBits(payload, 77, false);
  const audioSamples = FSKModulator.modulate(bits, config);

  const demodulator = new FSKDemodulator(config);
  const packets = demodulator.processAudioBuffer(audioSamples);

  assert.equal(packets.length, 1, 'Should decode packet at 2000 bps');
  assert.equal(packets[0].seq, 77);
  assert.equal(packets[0].crcValid, true);
  assert.equal(packets[0].text, message);
});



