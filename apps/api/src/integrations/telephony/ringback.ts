/**
 * Standard North American ringback tone (440 Hz + 480 Hz, 2 s on / 4 s off),
 * generated once as an 8 kHz 16-bit mono WAV. Played to the caller while the
 * owner's phone rings, so they hear normal ringing instead of silence.
 */
function buildRingback(): Buffer {
  const sampleRate = 8000;
  const seconds = 6;
  const samples = sampleRate * seconds;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const on = t < 2;
    const value = on ? 0.18 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t)) : 0;
    data.writeInt16LE(Math.round(value * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export const RINGBACK_WAV = buildRingback();
