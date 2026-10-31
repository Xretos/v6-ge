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

test('Selective Retransmission (ARQ): Hole filling and selective packet retransmission', () => {
  const filename = 'patch.bin';
  const fileBytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
  const config = { ...DEFAULT_CONFIG, sampleRate: 48000, baudRate: 500, markFreq: 1500, spaceFreq: 2500, useFEC: true };

  // 1. Split file into 4 chunks (3 bytes each) -> chunks 0, 1, 2, 3
  const allPackets = FileChunker.createFilePackets(filename, fileBytes, 'application/octet-stream', 3, true, 1);
  assert.equal(allPackets.length, 6); // FILE_START, 4x DATA, FILE_END

  const demodulator = new FSKDemodulator(config);
  const assembler = new FileAssembler();
  assembler.clearStorage();
  let completedFile: any = null;
  assembler.onComplete = (f) => { completedFile = f; };

  // 2. Deliver FILE_START, chunk 0, chunk 2, chunk 3, and FILE_END (Simulate dropping chunk 1!)
  const droppedIndices = [2]; // packet index 2 corresponds to chunk 1
  for (let i = 0; i < allPackets.length; i++) {
    if (i === 2) continue; // DROP CHUNK 1
    const p = allPackets[i];
    const audio = FSKModulator.modulate(p.bits, config);
    const pkts = demodulator.processAudioBuffer(audio);
    for (const pkt of pkts) assembler.processPacket(pkt);
  }

  // File should NOT be complete yet, because chunk 1 is missing!
  assert.equal(completedFile, null, 'File should not be complete when chunk 1 is missing');
  const missing = assembler.getMissingChunkIndices();
  assert.deepEqual(missing, [1], 'Missing chunk index should be 1');
  const missing1Based = assembler.getMissingChunkNumbers1Based();
  assert.deepEqual(missing1Based, [2], '1-based missing chunk number should be 2');

  // 3. Perform selective retransmission for chunk 1 (0-based)
  const retransmitPackets = FileChunker.createSelectivePackets(
    filename,
    fileBytes,
    'application/octet-stream',
    3,
    true,
    [1], // retransmit chunk 1
    99
  );
  assert.equal(retransmitPackets.length, 2);

  // Deliver the retransmitted chunk to assembler
  const retransmitAudio = FSKModulator.modulate(retransmitPackets[0].bits, config);
  const rxPkts = demodulator.processAudioBuffer(retransmitAudio);
  for (const pkt of rxPkts) {
    assembler.processPacket(pkt);
  }

  // Now the file should be finalized and complete!
  if (!completedFile) {
    completedFile = assembler.finalizeFile();
  }
  assert.ok(completedFile !== null, 'File should finalize after receiving dropped chunk');
  assert.equal(completedFile.size, fileBytes.length);
  assert.equal(completedFile.crcValid, true);
  assert.deepEqual(completedFile.data, fileBytes);
});

test('parseChunkNumbersInput: parses single, comma-separated, space-separated, and range numbers', async () => {
  const { parseChunkNumbersInput } = await import('./fsk');
  // 1-based user input "1, 3, 5-7, 10" with maxChunks = 12
  const parsed = parseChunkNumbersInput('1, 3, 5-7, 10', 12);
  // Expect 0-based indices: 0, 2, 4, 5, 6, 9
  assert.deepEqual(parsed, [0, 2, 4, 5, 6, 9]);

  // Chinese punctuation and spaces
  const parsedZh = parseChunkNumbersInput('2， 4； 8~10', 10);
  assert.deepEqual(parsedZh, [1, 3, 7, 8, 9]);

  // Out of bounds filtering
  const parsedOob = parseChunkNumbersInput('0, 1, 99', 5);
  assert.deepEqual(parsedOob, [0]);
});

test('4-FSK High-Stability Mode: 2000 bps (1000 Baud, 4 tones) with 256-byte large chunks', () => {
  const payload = new Uint8Array(256);
  for (let i = 0; i < 256; i++) payload[i] = (i * 37 + 11) & 0xff;

  const config = {
    sampleRate: 48000,
    baudRate: 1000, // 1000 Baud * 2 bits = 2000 bps!
    modulationScheme: '4FSK' as const,
    markFreq: 3000,
    spaceFreq: 1000,
    frequencies: [1000, 2000, 3000, 4000],
    amplitude: 0.8,
    useFEC: true,
  };

  const bits = FrameEncoder.encodePacketToBits(payload, 55, true, PacketType.FILE_DATA, '4FSK');
  const audio = FSKModulator.modulate(bits, config);

  const demodulator = new FSKDemodulator(config);
  const packets = demodulator.processAudioBuffer(audio);

  assert.equal(packets.length, 1, 'Should decode the 256-byte large chunk');
  assert.equal(packets[0].seq, 55);
  assert.equal(packets[0].crcValid, true, 'CRC must pass on large 256-byte chunk');
  assert.equal(packets[0].payload.length, 256);
  assert.deepEqual(packets[0].payload, payload);
});

test('4-FSK Turbo Mode: 4000 bps (2000 Baud, 4 tones) Double-Speed Transfer', () => {
  const message = '4-FSK-4000BPS-DOUBLE-SPEED';
  const payload = new TextEncoder().encode(message);

  const config = {
    sampleRate: 48000,
    baudRate: 2000, // 2000 Baud * 2 bits = 4000 bps!
    modulationScheme: '4FSK' as const,
    markFreq: 5000,
    spaceFreq: 1000,
    frequencies: [1000, 3000, 5000, 7000],
    amplitude: 0.85,
    useFEC: false,
  };

  const bits = FrameEncoder.encodePacketToBits(payload, 102, false, PacketType.TEXT, '4FSK');
  const audio = FSKModulator.modulate(bits, config);

  const demodulator = new FSKDemodulator(config);
  const packets = demodulator.processAudioBuffer(audio);

  assert.equal(packets.length, 1);
  assert.equal(packets[0].seq, 102);
  assert.equal(packets[0].crcValid, true);
  assert.equal(packets[0].text, message);
});

test('4-FSK 2000 bps: Multi-Chunk File Transfer with 384-byte extra-large chunks', () => {
  const filename = 'large_firmware.bin';
  const fileBytes = new Uint8Array(768); // 2 chunks of 384 bytes
  for (let i = 0; i < fileBytes.length; i++) fileBytes[i] = (i * 13 + 7) & 0xff;

  const config = {
    sampleRate: 48000,
    baudRate: 1000,
    modulationScheme: '4FSK' as const,
    markFreq: 3000,
    spaceFreq: 1000,
    frequencies: [1000, 2000, 3000, 4000],
    amplitude: 0.8,
    useFEC: false,
  };

  const packets = FileChunker.createFilePackets(filename, fileBytes, 'application/octet-stream', 384, false, 1, '4FSK');
  assert.equal(packets.length, 4); // START, 2 DATA, END

  const demodulator = new FSKDemodulator(config);
  const assembler = new FileAssembler();
  assembler.clearStorage();
  let completedFile: any = null;
  assembler.onComplete = (f) => { completedFile = f; };

  for (const p of packets) {
    const audio = FSKModulator.modulate(p.bits, config);
    const rxPkts = demodulator.processAudioBuffer(audio);
    for (const pkt of rxPkts) {
      assembler.processPacket(pkt);
    }
  }

  assert.ok(completedFile !== null, 'File should assemble completely');
  assert.equal(completedFile.size, fileBytes.length);
  assert.equal(completedFile.crcValid, true);
  assert.deepEqual(completedFile.data, fileBytes);
});

test('8-FSK Turbo Mode: 3000 bps (1000 Baud, 8 tones, 3 bits/symbol)', () => {
  const message = '8-FSK-3000BPS-TEST-DATA';
  const payload = new TextEncoder().encode(message);

  const config = {
    sampleRate: 48000,
    baudRate: 1000, // 1000 Baud * 3 bits = 3000 bps!
    modulationScheme: '8FSK' as const,
    markFreq: 4000,
    spaceFreq: 1000,
    frequencies: [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000],
    amplitude: 0.85,
    useFEC: false,
  };

  const bits = FrameEncoder.encodePacketToBits(payload, 88, false, PacketType.TEXT, '8FSK');
  const audio = FSKModulator.modulate(bits, config);

  const demodulator = new FSKDemodulator(config);
  const packets = demodulator.processAudioBuffer(audio);

  assert.equal(packets.length, 1);
  assert.equal(packets[0].seq, 88);
  assert.equal(packets[0].crcValid, true);
  assert.equal(packets[0].text, message);
});

test('Selective Retransmission: Auto-Assembly triggers when last missing chunk arrives', () => {
  const filename = 'auto_merge_test.bin';
  const fileBytes = new Uint8Array(512);
  for (let i = 0; i < fileBytes.length; i++) fileBytes[i] = (i * 7 + 3) & 0xff;

  const chunkSize = 128; // 4 chunks
  const packets = FileChunker.createFilePackets(filename, fileBytes, 'application/octet-stream', chunkSize, false, 1, '4FSK');
  assert.equal(packets.length, 6); // START, 4 DATA (0,1,2,3), END

  const assembler = new FileAssembler();
  assembler.clearStorage();
  let completedFile: any = null;
  assembler.onComplete = (f) => { completedFile = f; };

  // First pass: deliver START, chunk 0, chunk 1, chunk 3 (simulate dropping chunk 2), then deliver END
  assembler.processPacket({
    seq: 1,
    crcValid: true,
    packetType: PacketType.FILE_START,
    payload: packets[0].payload,
    fecCorrections: 0,
    fileMeta: { name: filename, size: fileBytes.length, chunks: 4, mime: 'application/octet-stream' }
  } as any);
  assembler.processPacket({
    seq: 2,
    crcValid: true,
    packetType: PacketType.FILE_DATA,
    payload: packets[1].payload,
    fecCorrections: 0,
    fileMeta: { chunkIdx: 0, totalChunks: 4, chunkData: fileBytes.subarray(0, 128) }
  } as any);
  assembler.processPacket({
    seq: 3,
    crcValid: true,
    packetType: PacketType.FILE_DATA,
    payload: packets[2].payload,
    fecCorrections: 0,
    fileMeta: { chunkIdx: 1, totalChunks: 4, chunkData: fileBytes.subarray(128, 256) }
  } as any);
  assembler.processPacket({
    seq: 5,
    crcValid: true,
    packetType: PacketType.FILE_DATA,
    payload: packets[4].payload,
    fecCorrections: 0,
    fileMeta: { chunkIdx: 3, totalChunks: 4, chunkData: fileBytes.subarray(384, 512) }
  } as any);
  assembler.processPacket({
    seq: 6,
    crcValid: true,
    packetType: PacketType.FILE_END,
    payload: packets[5].payload,
    fecCorrections: 0,
    fileMeta: { name: filename, size: fileBytes.length, chunks: 4, crc: CRC16.compute(fileBytes) }
  } as any);

  // Verification: missing chunk 2 (1-based #3)
  assert.equal(completedFile, null, 'File should not assemble while chunk 2 is missing');
  assert.deepEqual(assembler.getMissingChunkNumbers1Based(), [3]);

  // Now, simulate receiving selective retransmission for chunk 2 ONLY (without sending FILE_END again)
  const result = assembler.processPacket({
    seq: 7,
    crcValid: true,
    packetType: PacketType.FILE_DATA,
    payload: packets[3].payload,
    fecCorrections: 0,
    fileMeta: { chunkIdx: 2, totalChunks: 4, chunkData: fileBytes.subarray(256, 384) }
  } as any);

  // Verification: BUG 2 fixed! Auto-assembly MUST trigger on the final FILE_DATA chunk!
  assert.ok(result !== null, 'processPacket should return assembled file immediately upon receiving final chunk');
  assert.ok(completedFile !== null, 'assembler.onComplete should fire on final chunk');
  assert.equal((completedFile as any).size, fileBytes.length);
  assert.equal((completedFile as any).crcValid, true);
  assert.deepEqual((completedFile as any).data, fileBytes);
});

test('Hardware Wakeup Tone: Generates 120ms non-empty soft cosine tapered audio burst', () => {
  const tone = FSKModulator.generateWakeupTone(48000, 2000, 0.12, 0.5);
  assert.equal(tone.length, Math.round(48000 * 0.12));
  assert.equal(tone[0], 0, 'First sample should be smoothly zero due to Hann ramp');
  let maxAmp = 0;
  for (let i = 0; i < tone.length; i++) {
    if (Math.abs(tone[i]) > maxAmp) maxAmp = Math.abs(tone[i]);
  }
  assert.ok(maxAmp > 0.45 && maxAmp <= 0.5, 'Max amplitude should reach specified level');
});

test('8-FSK 4500 bps (1500 Baud, 8 tones, 256B large chunks): 100% transmission success', () => {
  const payload = new Uint8Array(256);
  for (let i = 0; i < 256; i++) payload[i] = (i * 31 + 17) & 0xff;

  const config = {
    sampleRate: 48000,
    baudRate: 1500,
    modulationScheme: '8FSK' as const,
    markFreq: 6000,
    spaceFreq: 1500,
    frequencies: [1500, 3000, 4500, 6000, 7500, 9000, 10500, 12000],
    amplitude: 0.85,
    useFEC: false,
  };

  const bits = FrameEncoder.encodePacketToBits(payload, 50, false, PacketType.FILE_DATA, '8FSK');
  const audio = FSKModulator.modulate(bits, config);
  const demodulator = new FSKDemodulator(config);
  const packets = demodulator.processAudioBuffer(audio);

  assert.equal(packets.length, 1);
  assert.equal(packets[0].seq, 50);
  assert.equal(packets[0].crcValid, true);
  assert.deepEqual(packets[0].payload, payload);
});

test('8-FSK 6000 bps Exact Integer Fourier Bins (2000 Baud, 256B chunks): 100% CRC validation', () => {
  const payload = new Uint8Array(256);
  for (let i = 0; i < 256; i++) payload[i] = (i * 19 + 43) & 0xff;

  const config = {
    sampleRate: 48000,
    baudRate: 2000,
    modulationScheme: '8FSK' as const,
    markFreq: 8000,
    spaceFreq: 2000,
    frequencies: [2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000],
    amplitude: 0.85,
    useFEC: false,
  };

  const bits = FrameEncoder.encodePacketToBits(payload, 77, false, PacketType.FILE_DATA, '8FSK');
  const audio = FSKModulator.modulate(bits, config);
  const demodulator = new FSKDemodulator(config);
  const packets = demodulator.processAudioBuffer(audio);

  assert.equal(packets.length, 1);
  assert.equal(packets[0].seq, 77);
  assert.equal(packets[0].crcValid, true);
  assert.deepEqual(packets[0].payload, payload);
});





