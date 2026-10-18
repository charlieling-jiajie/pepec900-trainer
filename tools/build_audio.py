#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""离线生成 900 句参考音。

引擎：
  kokoro  —— Kokoro-82M（更接近人声，24kHz），默认
  piper   —— vits-piper lessac（旧版，作回退）

用法：
  python tools/build_audio.py --engine kokoro --sid 16 --force
  python tools/build_audio.py --engine kokoro --sid 31 --audition   # 试听片段
"""
import argparse, json, os, re, time
import numpy as np
import sherpa_onnx
import lameenc

GAP_COMMA = 0.16   # 逗号停顿（秒）
GAP_STOP = 0.42    # 句号/问号停顿（秒）


def synth_with_pauses(tts, text, sid, speed):
    """Kokoro 不理会标点，这里按标点切段合成，再手动插入静音，保证可听见的停顿。"""
    pieces, sr = [], 24000
    for chunk, p in re.findall(r"([^,;:.?!]+)([,;:.?!]?)", text):
        chunk = chunk.strip()
        if not chunk:
            continue
        a = tts.generate(chunk, sid=sid, speed=speed)
        if len(a.samples) == 0:
            continue
        sr = a.sample_rate
        pieces.append(np.asarray(a.samples, dtype=np.float32))
        if p:
            gap = GAP_STOP if p in ".?!" else GAP_COMMA
            pieces.append(np.zeros(int(gap * sr), dtype=np.float32))
    if not pieces:
        return np.zeros(0, dtype=np.float32), sr
    while pieces and not pieces[-1].any():
        pieces.pop()
    return np.concatenate(pieces), sr

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "models")
KOKORO_DIR = os.path.join(MODELS, "kokoro-multi-lang-v1_0")
PIPER_DIR = os.path.join(MODELS, "vits-piper-en_US-lessac-medium")
OUT_DIR = os.path.join(ROOT, "web", "audio")
META = os.path.join(ROOT, "data", "audio_meta.json")
CORPUS = os.path.join(ROOT, "data", "corpus.json")


def make_kokoro(sid):
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=os.path.join(KOKORO_DIR, "model.onnx"),
                voices=os.path.join(KOKORO_DIR, "voices.bin"),
                tokens=os.path.join(KOKORO_DIR, "tokens.txt"),
                data_dir=os.path.join(KOKORO_DIR, "espeak-ng-data"),
                dict_dir=os.path.join(KOKORO_DIR, "dict"),
                lexicon=os.path.join(KOKORO_DIR, "lexicon-us-en.txt"),
                length_scale=1.0,
            ),
            num_threads=6, provider="cpu",
        ),
        max_num_sentences=1,
    )
    return sherpa_onnx.OfflineTts(cfg), sid


def make_piper():
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=os.path.join(PIPER_DIR, "en_US-lessac-medium.onnx"),
                tokens=os.path.join(PIPER_DIR, "tokens.txt"),
                data_dir=os.path.join(PIPER_DIR, "espeak-ng-data"),
                noise_scale=0.6, noise_scale_w=0.8, length_scale=1.05,
            ),
            num_threads=4, provider="cpu",
        ),
        max_num_sentences=1,
    )
    return sherpa_onnx.OfflineTts(cfg), 0


def encode_mp3(samples, sr, path, bitrate=64):
    pcm = np.clip(np.asarray(samples) * 32767, -32768, 32767).astype(np.int16)
    enc = lameenc.Encoder()
    enc.set_bit_rate(bitrate)
    enc.set_in_sample_rate(sr)
    enc.set_channels(1)
    enc.set_quality(3)
    data = enc.encode(pcm.tobytes()) + enc.flush()
    with open(path, "wb") as f:
        f.write(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", default="kokoro", choices=["kokoro", "piper"])
    ap.add_argument("--sid", type=int, default=16)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--speed", type=float, default=0.97)
    ap.add_argument("--audition", action="store_true", help="只生成试听片段到 web/audition")
    args = ap.parse_args()

    corpus = json.load(open(CORPUS, encoding="utf-8"))
    sents = corpus["sentences"]

    tts, sid = make_kokoro(args.sid) if args.engine == "kokoro" else make_piper()

    if args.audition:
        out = os.path.join(ROOT, "web", "audition")
        os.makedirs(out, exist_ok=True)
        picks = [1, 18, 219, 305]
        for s in sents:
            if s["id"] not in picks:
                continue
            samples, sr = synth_with_pauses(tts, s.get("tts") or s["spoken"], sid, args.speed)
            encode_mp3(samples, sr, os.path.join(out, f"{args.sid}_{s['id']}.mp3"))
            print(f"audition sid={args.sid} #{s['id']} {len(samples)/sr:.2f}s")
        return

    os.makedirs(OUT_DIR, exist_ok=True)
    meta = {}
    if os.path.exists(META) and not args.force:
        meta = json.load(open(META, encoding="utf-8"))

    t0 = time.time()
    done = 0
    for s in sents:
        key = str(s["id"])
        if args.only and key not in args.only:
            continue
        path = os.path.join(OUT_DIR, f"{key}.mp3")
        if os.path.exists(path) and key in meta and not args.force:
            continue
        samples, sr = synth_with_pauses(tts, s.get("tts") or s["spoken"], sid, args.speed)
        if len(samples) == 0:
            print("EMPTY", key, s["spoken"])
            continue
        encode_mp3(samples, sr, path)
        meta[key] = {"dur": round(len(samples) / sr, 3),
                     "kb": round(os.path.getsize(path) / 1024, 1)}
        done += 1
        if done % 50 == 0:
            el = time.time() - t0
            print(f"{done} done, {el:.0f}s, eta {el/done*(900-done):.0f}s", flush=True)
            json.dump(meta, open(META, "w", encoding="utf-8"), ensure_ascii=False, indent=0)

    json.dump(meta, open(META, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    total = sum(v["kb"] for v in meta.values())
    print(f"OK {len(meta)} files, {total/1024:.1f} MB, {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
