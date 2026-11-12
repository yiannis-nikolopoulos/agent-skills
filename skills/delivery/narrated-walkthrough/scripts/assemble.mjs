#!/usr/bin/env node
// Joins the captured frames, each step's narration placed where that step really started, and subtitles into one MP4.
// Requires: node >= 18, ffmpeg with libx264.
//
//   node assemble.mjs <walkthrough.json> [--out <file.mp4>] [--no-subs] [--crf 18]
//
// Reads frames.json, timeline.json, and audio/manifest.json next to walkthrough.json.
// Writes <slug>.mp4 and <slug>.srt there unless --out names another file.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULTS, buildConcat, buildSrt } from './lib.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const specPath = args.find((arg, index) => !arg.startsWith('--') && !['--out', '--crf'].includes(args[index - 1]));
if (!specPath) {
  console.error('usage: node assemble.mjs <walkthrough.json> [--out <file.mp4>] [--no-subs] [--crf 18]');
  process.exit(2);
}

const dir = path.dirname(path.resolve(specPath));
const read = (name) => {
  const file = path.join(dir, name);
  if (!existsSync(file)) {
    console.error(`ERROR: ${file} is missing; run ${name.startsWith('audio') ? 'narrate.py' : 'record.mjs'} first`);
    process.exit(3);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
};

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const timeline = read('timeline.json');
const allFrames = read('frames.json');
const manifest = read('audio/manifest.json');

const missingAudio = timeline.steps.filter((mark) => !manifest.steps.some((step) => step.id === mark.id));
if (missingAudio.length) {
  console.error(`ERROR: no narration for ${missingAudio.map((mark) => mark.id).join(', ')}; run narrate.py again`);
  process.exit(3);
}
const stale = timeline.steps.filter((mark) => {
  const step = manifest.steps.find((candidate) => candidate.id === mark.id);
  return Math.abs(step.duration - mark.narration) > 0.05;
});
if (stale.length) {
  console.error(`ERROR: narration for ${stale.map((mark) => mark.id).join(', ')} changed after recording; record.mjs again so the holds match`);
  process.exit(3);
}

// Frames that arrived before the clock started are covered by the latest of them.
const firstLive = allFrames.findIndex((frame) => frame.ts > timeline.t0);
const frames = firstLive <= 0 ? allFrames : allFrames.slice(firstLive - 1);
const slug = spec.slug ?? spec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outFile = path.resolve(option('--out') ?? path.join(dir, `${slug}.mp4`));
const srtFile = outFile.replace(/\.mp4$/, '.srt');
const withSubs = !args.includes('--no-subs');
// CRF 18 is visually lossless for screen content in x264 while staying a few MB per minute.
const crf = option('--crf') ?? '18';

writeFileSync(path.join(dir, 'frames.ffconcat'), buildConcat(frames, timeline.t0, timeline.end));
writeFileSync(srtFile, buildSrt(timeline.steps, manifest));

const width = timeline.width - (timeline.width % 2);
const height = timeline.height - (timeline.height % 2);
const inputs = ['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'frames.ffconcat')];
const audioLabels = [];
const filters = [`[0:v]fps=${spec.fps ?? DEFAULTS.fps},scale=${width}:${height}:flags=lanczos,format=yuv420p[v]`];
timeline.steps.forEach((mark, index) => {
  const step = manifest.steps.find((candidate) => candidate.id === mark.id);
  inputs.push('-i', path.join(dir, 'audio', step.file));
  const delay = Math.round(mark.start * 1000);
  filters.push(`[${index + 1}:a]adelay=${delay}:all=1[a${index}]`);
  audioLabels.push(`[a${index}]`);
});
filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0,apad[a]`);

const subIndex = timeline.steps.length + 1;
if (withSubs) inputs.push('-i', srtFile);

const command = [
  '-y',
  '-hide_banner',
  '-loglevel', 'error',
  ...inputs,
  '-filter_complex', filters.join(';'),
  '-map', '[v]',
  '-map', '[a]',
  ...(withSubs ? ['-map', `${subIndex}:s`, '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng'] : []),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', crf,
  '-c:a', 'aac', '-b:a', '160k',
  '-t', String(timeline.duration),
  '-movflags', '+faststart',
  outFile,
];
const result = spawnSync('ffmpeg', command, { stdio: ['ignore', 'inherit', 'inherit'] });
if (result.status !== 0) {
  console.error('ERROR: ffmpeg failed; command was:');
  console.error(`ffmpeg ${command.map((part) => (/[\s;[\]]/.test(part) ? `'${part}'` : part)).join(' ')}`);
  process.exit(1);
}

console.log(JSON.stringify({
  video: outFile,
  subtitles: srtFile,
  seconds: timeline.duration,
  size: `${(statSync(outFile).size / 1_048_576).toFixed(1)} MB`,
  resolution: `${width}x${height}`,
  steps: timeline.steps.length,
  softSubtitles: withSubs,
}));
