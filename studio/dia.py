# Walk & Talk voices with Dia (nari-labs/Dia-1.6B, Apache-2.0): voices a whole
# conversation so the back-and-forth sounds natural, then cuts it into one wav
# per line so render.mjs can time subtitles and scenes exactly as with Kokoro.
#
#   python dia.py lines.json outdir
#   lines.json: [{id, who: friend|guide, scene, text}]   ->  outdir/<id>.wav
#
# The same two voices every time come from a reference clip (voices/dia/ref.wav +
# ref.txt, friend = [S1], guide = [S2]; ref-friend.wav / ref-guide.wav are its two
# halves) given to Dia as an audio prompt. Each chunk is checked with Whisper and a
# speaker-verification model; a chunk that skips words or swaps voices is retried.
import sys, os, json, re, difflib, numpy as np, soundfile as sf, librosa, torch
from transformers import AutoProcessor, DiaForConditionalGeneration, pipeline, AutoFeatureExtractor, WavLMForXVector

HERE = os.path.dirname(os.path.abspath(__file__))
DEV = 'mps' if torch.backends.mps.is_available() else 'cpu'
SR = 44100
TAG = {'friend': '[S1]', 'guide': '[S2]'}
MAX_CHARS = 230   # text per Dia call: longer chunks make Dia rush
TRIES = 4

lines = json.load(open(sys.argv[1]))
out = sys.argv[2]
ref_wav = os.path.join(HERE, 'voices', 'dia', 'ref.wav')
ref_txt = os.path.join(HERE, 'voices', 'dia', 'ref.txt')
use_ref = os.path.exists(ref_wav) and os.path.exists(ref_txt)
seed0 = int(os.environ.get('DIA_SEED', '7'))

proc = AutoProcessor.from_pretrained('nari-labs/Dia-1.6B-0626')
# bfloat16 halves memory (fp32 needs ~11 GB and swaps an 18 GB Mac to a crawl)
DTYPE = torch.bfloat16 if DEV == 'mps' else torch.float32
model = DiaForConditionalGeneration.from_pretrained('nari-labs/Dia-1.6B-0626', torch_dtype=DTYPE).to(DEV)
asr = pipeline('automatic-speech-recognition', model='openai/whisper-small', device=DEV, torch_dtype=torch.float16)
ref_audio = librosa.load(ref_wav, sr=SR)[0] if use_ref else None
# Speaker check: every line must sound more like its own reference voice than the other one.
sv_fe = AutoFeatureExtractor.from_pretrained('microsoft/wavlm-base-plus-sv')
sv = WavLMForXVector.from_pretrained('microsoft/wavlm-base-plus-sv').eval()
def embed(y, sr):
    i = sv_fe(librosa.resample(y, orig_sr=sr, target_sr=16000), sampling_rate=16000, return_tensors='pt')
    with torch.no_grad(): return torch.nn.functional.normalize(sv(**i).embeddings[0], dim=-1).numpy()
REF_EMB = {w: embed(librosa.load(os.path.join(HERE, 'voices', 'dia', f'ref-{w}.wav'), sr=SR)[0], SR) for w in ('friend', 'guide')} if use_ref else None
ref_text = open(ref_txt).read().strip() if use_ref else ''

spoken = lambda t: re.sub(r'\s+', ' ', re.sub(r'\([^)]*\)', ' ', t)).strip()   # drop (laughs) etc.
norm = lambda t: re.sub(r'[^a-z0-9]', '', t.lower().replace('.com', 'dotcom'))

# Chunks: whole scenes, packed up to MAX_CHARS, so a cut never splits an exchange.
scenes = []
for l in lines:
    if scenes and scenes[-1][0]['scene'] == l['scene']: scenes[-1].append(l)
    else: scenes.append([l])
chunks = []
for s in scenes:
    if chunks and sum(len(l['text']) for l in chunks[-1] + s) <= MAX_CHARS: chunks[-1] += s
    else: chunks.append(list(s))

def generate(ls, seed):
    torch.manual_seed(seed)
    text = ' '.join(f"{TAG[l['who']]} {l['text']}" for l in ls)
    if use_ref:
        inp = proc(text=[ref_text + ' ' + text], audio=[ref_audio], padding=True, return_tensors='pt').to(DEV)
        plen = proc.get_audio_prompt_len(inp['decoder_attention_mask'])
        o = model.generate(**inp, max_new_tokens=3072, guidance_scale=3.0, temperature=1.8, top_p=0.90, top_k=45)
        audio = proc.batch_decode(o, audio_prompt_len=plen)
    else:
        inp = proc(text=[text], padding=True, return_tensors='pt').to(DEV)
        o = model.generate(**inp, max_new_tokens=3072, guidance_scale=3.0, temperature=1.8, top_p=0.90, top_k=45)
        audio = proc.batch_decode(o)
    if DEV == 'mps': torch.mps.empty_cache()
    a = audio[0]
    return (a.cpu().float().numpy() if hasattr(a, 'cpu') else np.asarray(a, dtype=np.float32)).reshape(-1)

def align(audio, ls):
    """Map Whisper's words onto the script; return per-line (start, end) seconds and match quality."""
    y16 = librosa.resample(audio, orig_sr=SR, target_sr=16000)
    words = [w for w in asr({'raw': y16, 'sampling_rate': 16000}, return_timestamps='word', generate_kwargs={'language': 'en'})['chunks'] if norm(w['text'])]
    script, owner = '', []
    for i, l in enumerate(ls):
        n = norm(spoken(l['text'])); script += n; owner += [i] * len(n)
    heard, wstart = '', []
    for j, w in enumerate(words):
        wstart.append(len(heard)); heard += norm(w['text'])
    sm = difflib.SequenceMatcher(None, script, heard, autojunk=False)
    h2s = {}
    for a, b, size in sm.get_matching_blocks():
        for k in range(size): h2s[b + k] = a + k
    per_line = [[] for _ in ls]
    for j, w in enumerate(words):
        span = range(wstart[j], wstart[j] + len(norm(w['text'])))
        hits = [owner[h2s[k]] for k in span if k in h2s]
        if hits: per_line[max(set(hits), key=hits.count)].append(w)
    matched = np.zeros(len(script), bool)
    for a, b, size in sm.get_matching_blocks(): matched[a:a + size] = True
    quality = [float(matched[[k for k, o in enumerate(owner) if o == i]].mean()) for i in range(len(ls))]
    return per_line, quality, len(heard) / max(1, len(script))

os.makedirs(out, exist_ok=True)
for c, ls in enumerate(chunks):
    best = None
    for t in range(TRIES):
        audio = generate(ls, seed0 + 101 * t + c)
        per_line, q, extra = align(audio, ls)
        wrong = 0
        if REF_EMB:
            for i, l in enumerate(ls):
                if not per_line[i]: continue
                s0, e0 = per_line[i][0]['timestamp'][0], per_line[i][-1]['timestamp'][1] or per_line[i][-1]['timestamp'][0] + .3
                e = embed(audio[int(s0 * SR):int(e0 * SR)], SR)
                other = 'guide' if l['who'] == 'friend' else 'friend'
                wrong += float(e @ REF_EMB[l['who']]) <= float(e @ REF_EMB[other])
        score = min(q) - max(0, extra - 1.15) - wrong  # penalise missing words, invented ones, and the wrong voice
        print(f"chunk {c + 1}/{len(chunks)} try {t + 1}: match {[round(x, 2) for x in q]} heard/script {extra:.2f} wrong voice {wrong}", flush=True)
        if best is None or score > best[0]: best = (score, audio, per_line)
        if min(q) >= 0.9 and extra <= 1.15 and all(per_line) and not wrong: break
    _, audio, per_line = best
    dur = len(audio) / SR
    for i, l in enumerate(ls):
        ws = per_line[i]
        if not ws: raise SystemExit(f"Dia dropped line {l['id']}: {l['text']}")
        s0, e0 = ws[0]['timestamp'][0], ws[-1]['timestamp'][1] or ws[-1]['timestamp'][0] + .3
        prev_end = per_line[i - 1][-1]['timestamp'][1] if i else None
        nxt = per_line[i + 1][0]['timestamp'][0] if i + 1 < len(ls) and per_line[i + 1] else None
        a = max(0, (prev_end + s0) / 2 if prev_end else s0 - .25)
        b = min(dur, (e0 + nxt) / 2 if nxt else e0 + .35)
        sf.write(os.path.join(out, l['id'] + '.wav'), audio[int(a * SR):int(b * SR)], SR)
print('dia: voiced', len(lines), 'lines in', len(chunks), 'chunks', flush=True)
