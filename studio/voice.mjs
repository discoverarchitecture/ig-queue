// Kokoro-82M (Apache-2.0) offline TTS. usage: node voice.mjs <lines.json> <outdir>
//   lines.json: [{ "id": "s1", "text": "...", "voice": "am_michael", "speed": 1 }]
import { KokoroTTS } from 'kokoro-js';
import fs from 'node:fs';
const [linesPath, out] = process.argv.slice(2);
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
fs.mkdirSync(out, { recursive: true });
for (const l of JSON.parse(fs.readFileSync(linesPath, 'utf8'))) {
  const audio = await tts.generate(l.text, { voice: l.voice || 'am_michael', speed: l.speed || 1 });
  audio.save(`${out}/${l.id}.wav`);
  console.log(l.id, (audio.audio.length / audio.sampling_rate).toFixed(2) + 's');
}
