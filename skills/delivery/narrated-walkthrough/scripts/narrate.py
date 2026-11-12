# /// script
# requires-python = ">=3.10"
# dependencies = ["kokoro-onnx>=0.4", "soundfile"]
# ///
"""Voice every step of a walkthrough.json into one audio clip per step, offline.

    uv run narrate.py <walkthrough.json> [--out <dir>] [--engine auto|kokoro|say|files]
                      [--voice af_heart] [--say-voice Samantha] [--speed 1.0] [--line-gap 0.35]
                      [--src <dir>] [--force]

Writes <out>/<step-id>.wav and <out>/manifest.json:
  {"engine", "voice", "steps": [{"id", "file", "duration", "hash", "lines": [{"text", "start", "end"}]}]}
Line start/end are seconds from the start of that step's clip. A step whose text, voice, engine,
and speed are unchanged keeps its clip, so editing one line re-voices one step.

Engines:
  kokoro  Kokoro-82M via kokoro-onnx; about 350 MB of model files download once.
  say     macOS `say`; zero dependencies, so `python3 narrate.py --engine say` works without uv.
  files   your own recordings at <src>/<step-id>.(wav|m4a|mp3|aiff); line times are spread by length.
  auto    kokoro, falling back to say when kokoro cannot run.

Requires: ffmpeg and ffprobe on PATH.
Kokoro loading and the say fallback follow nicolastakashi/skills visual-explainer/scripts/narrate.py (MIT).
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

MODELS = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
CACHE = Path.home() / ".cache" / "narrated-walkthrough" / "kokoro"
# visual-explainer downloads the same two files; reuse them instead of fetching 350 MB again.
SHARED_CACHE = Path.home() / ".cache" / "visual-explainer" / "kokoro"
# A Kokoro voice id starts with its language letter: af_heart is American English.
LANGS = {"a": "en-us", "b": "en-gb", "e": "es", "f": "fr-fr", "h": "hi", "i": "it", "j": "ja", "p": "pt-br", "z": "cmn"}
# -16 LUFS integrated is the common loudness target for spoken web video.
LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11"
RATE = "48000"
SOURCE_EXTS = (".wav", ".m4a", ".mp3", ".aiff")


def run(*cmd):
    subprocess.run([str(part) for part in cmd], check=True, capture_output=True)


def seconds(path):
    out = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)])
    return float(out)


def line_text(line):
    return line if isinstance(line, str) else line["text"]


def line_speech(line):
    return line if isinstance(line, str) else line.get("speak", line["text"])


def model_file(name):
    for folder in (CACHE, SHARED_CACHE):
        if (folder / name).exists():
            return str(folder / name)
    CACHE.mkdir(parents=True, exist_ok=True)
    print(f"downloading {name} (once)", file=sys.stderr)
    part = (CACHE / name).with_suffix(".part")
    urllib.request.urlretrieve(f"{MODELS}/{name}", part)
    part.rename(CACHE / name)
    return str(CACHE / name)


class KokoroVoice:
    def __init__(self, voice, speed):
        from kokoro_onnx import Kokoro

        self.kokoro = Kokoro(model_file("kokoro-v1.0.onnx"), model_file("voices-v1.0.bin"))
        self.voice, self.speed, self.lang = voice, speed, LANGS.get(voice[0], "en-us")

    def speak(self, text, path):
        import soundfile

        samples, rate = self.kokoro.create(text, voice=self.voice, speed=self.speed, lang=self.lang)
        soundfile.write(path.with_suffix(".wav"), samples, rate)
        return path.with_suffix(".wav")


class SayVoice:
    def __init__(self, voice, speed):
        self.voice = voice
        # `say` takes words per minute; 175 is its documented default rate.
        self.rate = str(round(175 * speed))

    def speak(self, text, path):
        out = path.with_suffix(".aiff")
        run("say", *(["-v", self.voice] if self.voice else []), "-r", self.rate, "-o", out, text)
        return out


def normalize(source, dest, pad=0.0):
    pad_filter = f",apad=pad_dur={pad}" if pad > 0 else ""
    run("ffmpeg", "-y", "-i", source, "-af", f"{LOUDNORM},afade=t=in:d=0.02{pad_filter}", "-ar", RATE, "-ac", "1", dest)


def concat(parts, dest, scratch):
    listing = scratch / "list.txt"
    listing.write_text("".join(f"file '{part.resolve()}'\n" for part in parts))
    run("ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listing, "-c", "copy", dest)


def voice_step(step, engine, out, scratch, line_gap):
    lines, parts, cursor = [], [], 0.0
    for index, line in enumerate(step["say"]):
        raw = engine.speak(line_speech(line), scratch / f"{step['id']}-{index}-raw")
        gap = line_gap if index + 1 < len(step["say"]) else 0.0
        part = scratch / f"{step['id']}-{index}.wav"
        normalize(raw, part, gap)
        length = seconds(part)
        lines.append({"text": line_text(line), "start": round(cursor, 3), "end": round(cursor + length - gap, 3)})
        parts.append(part)
        cursor += length
    dest = out / f"{step['id']}.wav"
    concat(parts, dest, scratch)
    return dest, lines


def spread_lines(texts, duration):
    total = sum(len(text) for text in texts) or 1
    lines, cursor = [], 0.0
    for text in texts:
        length = duration * len(text) / total
        lines.append({"text": text, "start": round(cursor, 3), "end": round(cursor + length, 3)})
        cursor += length
    return lines


def file_step(step, src, out):
    source = next((src / f"{step['id']}{ext}" for ext in SOURCE_EXTS if (src / f"{step['id']}{ext}").exists()), None)
    if source is None:
        sys.exit(f"no recording for step {step['id']} in {src} ({', '.join(SOURCE_EXTS)})")
    dest = out / f"{step['id']}.wav"
    normalize(source, dest)
    return dest, spread_lines([line_text(line) for line in step["say"]], seconds(dest))


def step_hash(step, engine_name, voice, speed, src):
    payload = {"say": step["say"], "engine": engine_name, "voice": voice, "speed": speed}
    if engine_name == "files":
        source = next((src / f"{step['id']}{ext}" for ext in SOURCE_EXTS if (src / f"{step['id']}{ext}").exists()), None)
        payload["source_mtime"] = source.stat().st_mtime if source else None
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def pick_engine(name, voice, say_voice, speed):
    if name in ("auto", "kokoro"):
        try:
            return "kokoro", voice, KokoroVoice(voice, speed)
        except Exception as error:
            if name == "kokoro" or not shutil.which("say"):
                raise
            print(f"kokoro unavailable ({error}); falling back to say", file=sys.stderr)
    if name in ("auto", "say"):
        return "say", say_voice or "system", SayVoice(say_voice, speed)
    return "files", "recorded", None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("spec")
    parser.add_argument("--out")
    parser.add_argument("--engine", choices=["auto", "kokoro", "say", "files"], default="auto")
    parser.add_argument("--voice")
    parser.add_argument("--say-voice")
    parser.add_argument("--speed", type=float)
    parser.add_argument("--line-gap", type=float, default=0.35, help="silence between lines inside a step, seconds")
    parser.add_argument("--src", help="folder of recordings for --engine files (default <out>/src)")
    parser.add_argument("--force", action="store_true", help="re-voice every step even when unchanged")
    args = parser.parse_args()

    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            sys.exit(f"{tool} is required")
    spec_path = Path(args.spec)
    spec = json.loads(spec_path.read_text())
    out = Path(args.out) if args.out else spec_path.parent / "audio"
    out.mkdir(parents=True, exist_ok=True)
    src = Path(args.src) if args.src else out / "src"
    voice = args.voice or spec.get("voice", "af_heart")
    speed = args.speed or spec.get("speed", 1.0)

    manifest_path = out / "manifest.json"
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"steps": []}
    cached = {step["id"]: step for step in previous["steps"]}

    engine_name, voice_name, engine = None, None, None
    steps, revoiced = [], []
    with tempfile.TemporaryDirectory() as tmp:
        scratch = Path(tmp)
        for step in spec["steps"]:
            digest = step_hash(step, args.engine, voice, speed, src)
            old = cached.get(step["id"])
            if not args.force and old and old["hash"] == digest and (out / old["file"]).exists():
                steps.append(old)
                continue
            if engine_name is None:
                engine_name, voice_name, engine = pick_engine(args.engine, voice, args.say_voice, speed)
            dest, lines = file_step(step, src, out) if engine_name == "files" else voice_step(step, engine, out, scratch, args.line_gap)
            steps.append({"id": step["id"], "file": dest.name, "duration": round(seconds(dest), 3), "hash": digest, "lines": lines})
            revoiced.append(step["id"])

    manifest = {"engine": engine_name or previous.get("engine"), "voice": voice_name or previous.get("voice"), "steps": steps}
    manifest_path.write_text(json.dumps(manifest, indent=1))
    print(json.dumps({
        "engine": manifest["engine"],
        "voice": manifest["voice"],
        "seconds": round(sum(step["duration"] for step in steps), 1),
        "steps": len(steps),
        "revoiced": revoiced,
        "manifest": str(manifest_path),
    }))


if __name__ == "__main__":
    main()
