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

test('Demodulation recovers and corrects bit error using Hamming(7,4) FEC', () => {
  const message = 'CORRECT-ME';
  const payload = new TextEncoder().encode(message);
  const config = { ...DEFAULT_CONFIG, sampleRate: 48000, baudRate: 100, useFEC: true };

  const bits = FrameEncoder.encodePacketToBits(payload, 1, true);

  // Intentionally flip one bit in the payload stream after sync word
  const corruptedBits = [...bits];
  // Preamble(16) + Sync(16) + Header(3*14=42) = bit 74 is in payload
  corruptedBits[75] ^= 1;

  const demodulator = new FSKDemodulator(config);
  const packets = demodulator.parsePacketsFromBits(corruptedBits);

  assert.equal(packets.length, 1);
  assert.equal(packets[0].crcValid, true, 'CRC should still be valid after FEC correction');
  assert.equal(packets[0].text, message);
  assert.ok(packets[0].fecCorrections > 0, 'FEC corrections count should be recorded');
});
