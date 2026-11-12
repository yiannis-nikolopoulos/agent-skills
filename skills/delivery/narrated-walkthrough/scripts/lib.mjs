#!/usr/bin/env node
// Pure helpers shared by record.mjs and assemble.mjs: spec validation, timing, ffconcat, and SRT.
// Requires: node >= 18. Zero dependencies.
//
//   node lib.mjs --self-test          run the fixtures, exit 0/1
//   node lib.mjs --validate <spec>    print one FAIL line per problem, exit 0/1

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULTS = {
  viewport: { width: 1280, height: 720 },
  // 1280x720 at 1.5 renders 1920x1080 frames with UI text large enough to read in a video player.
  scale: 1.5,
  // Pause after every action so the viewer sees its result before the next one starts.
  beatMs: 350,
  // Silence after a step's narration ends, before the next step starts.
  stepGapMs: 600,
  leadInMs: 800,
  tailMs: 1500,
  // Conversational narration speed; used only to estimate durations when no audio exists yet.
  wordsPerMinute: 150,
  fps: 30,
};

export const VERBS = ['goto', 'click', 'hover', 'type', 'fill', 'press', 'select', 'scroll', 'wait', 'waitFor', 'highlight'];

const VERB_NEEDS = {
  type: ['text'],
  fill: ['text'],
  select: ['value'],
};

const OPTIONAL_KEYS = new Set(['text', 'value', 'delay', 'ms', 'state', 'nth']);

export function lineText(line) {
  return typeof line === 'string' ? line : line.text;
}

export function lineSpeech(line) {
  return typeof line === 'string' ? line : line.speak ?? line.text;
}

export function verbOf(action) {
  return VERBS.find((verb) => Object.hasOwn(action, verb));
}

function validateAction(action, where, errors) {
  if (action === null || typeof action !== 'object' || Array.isArray(action)) {
    errors.push(`FAIL ${where} — action must be an object with one verb key`);
    return;
  }
  const verbs = VERBS.filter((verb) => Object.hasOwn(action, verb));
  if (verbs.length !== 1) {
    errors.push(`FAIL ${where} — action needs exactly one of ${VERBS.join(', ')}; found ${verbs.length ? verbs.join(', ') : 'none'}`);
    return;
  }
  const [verb] = verbs;
  for (const key of Object.keys(action)) {
    if (key !== verb && !OPTIONAL_KEYS.has(key)) errors.push(`FAIL ${where} — unknown key "${key}" on ${verb}`);
  }
  for (const key of VERB_NEEDS[verb] ?? []) {
    if (typeof action[key] !== 'string') errors.push(`FAIL ${where} — ${verb} needs a string "${key}"`);
  }
  const value = action[verb];
  if (verb === 'wait' && !(Number.isFinite(value) && value >= 0)) errors.push(`FAIL ${where} — wait takes milliseconds`);
  if (verb === 'scroll' && !(typeof value === 'string' || Number.isFinite(value))) errors.push(`FAIL ${where} — scroll takes a target or a pixel delta`);
  if (!['wait', 'scroll'].includes(verb) && (typeof value !== 'string' || value.trim() === '')) {
    errors.push(`FAIL ${where} — ${verb} takes a non-empty string`);
  }
}

export function validateSpec(spec) {
  const errors = [];
  if (spec === null || typeof spec !== 'object') return ['FAIL spec — must be a JSON object'];
  if (typeof spec.title !== 'string' || !spec.title.trim()) errors.push('FAIL title — required string');
  if (spec.baseUrl !== undefined && !/^https?:\/\//.test(spec.baseUrl)) errors.push('FAIL baseUrl — must start with http:// or https://');
  (spec.setup ?? []).forEach((action, index) => validateAction(action, `setup[${index}]`, errors));
  if (!Array.isArray(spec.steps) || spec.steps.length === 0) {
    errors.push('FAIL steps — need at least one step');
    return errors;
  }
  const seen = new Set();
  spec.steps.forEach((step, index) => {
    const where = `steps[${index}]`;
    if (typeof step.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(step.id)) {
      errors.push(`FAIL ${where}.id — kebab-case string required`);
    } else if (seen.has(step.id)) {
      errors.push(`FAIL ${where}.id — duplicate "${step.id}"`);
    } else {
      seen.add(step.id);
    }
    if (!Array.isArray(step.say) || step.say.length === 0) {
      errors.push(`FAIL ${where}.say — need at least one line`);
    } else {
      step.say.forEach((line, lineIndex) => {
        const text = typeof line === 'string' ? line : line?.text;
        if (typeof text !== 'string' || !text.trim()) errors.push(`FAIL ${where}.say[${lineIndex}] — empty line`);
      });
    }
    (step.do ?? []).forEach((action, actionIndex) => validateAction(action, `${where}.do[${actionIndex}]`, errors));
  });
  return errors;
}

export function resolveUrl(baseUrl, target) {
  if (/^https?:\/\//.test(target)) return target;
  if (!baseUrl) throw new Error(`relative goto "${target}" needs a baseUrl`);
  return new URL(target, baseUrl).toString();
}

export function estimateSeconds(lines, wordsPerMinute = DEFAULTS.wordsPerMinute) {
  const words = lines.map(lineSpeech).join(' ').split(/\s+/).filter(Boolean).length;
  return (words / wordsPerMinute) * 60;
}

// The concat demuxer ignores the last entry's duration, so the last frame is listed twice.
export function buildConcat(frames, startTs, endTs) {
  if (frames.length === 0) throw new Error('no frames captured');
  const out = ['ffconcat version 1.0'];
  frames.forEach((frame, index) => {
    const from = index === 0 ? startTs : frame.ts;
    const to = index + 1 < frames.length ? frames[index + 1].ts : endTs;
    out.push(`file '${frame.file}'`, `duration ${Math.max(0.001, to - from).toFixed(3)}`);
  });
  out.push(`file '${frames.at(-1).file}'`);
  return `${out.join('\n')}\n`;
}

export function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (value, width) => String(value).padStart(width, '0');
  return `${pad(Math.floor(ms / 3_600_000), 2)}:${pad(Math.floor(ms / 60_000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`;
}

// timeline: [{id, start}] in seconds from video start; manifest: {steps: [{id, lines: [{text, start, end}]}]}.
export function buildSrt(timeline, manifest) {
  const byId = new Map(manifest.steps.map((step) => [step.id, step]));
  const cues = [];
  for (const mark of timeline) {
    for (const line of byId.get(mark.id)?.lines ?? []) {
      cues.push({ start: mark.start + line.start, end: mark.start + line.end, text: line.text });
    }
  }
  return cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join('\n');
}

function selfTest() {
  const checks = [];
  const check = (name, condition) => checks.push([name, Boolean(condition)]);

  const good = {
    title: 'Demo',
    baseUrl: 'https://example.com',
    setup: [{ goto: '/start' }],
    steps: [
      { id: 'intro', say: ['Hello.'], do: [{ wait: 200 }] },
      { id: 'pick', say: [{ text: 'Dash0 rocks.', speak: 'Dash zero rocks.' }], do: [{ click: 'role=button[name="Go"]' }, { type: '#q', text: 'cpu' }] },
    ],
  };
  check('valid spec passes', validateSpec(good).length === 0);
  check('missing steps fails', validateSpec({ title: 'x' }).some((e) => e.includes('steps')));
  check('two verbs fail', validateSpec({ ...good, steps: [{ id: 'a', say: ['x'], do: [{ click: 'a', hover: 'b' }] }] }).some((e) => e.includes('exactly one')));
  check('unknown key fails', validateSpec({ ...good, steps: [{ id: 'a', say: ['x'], do: [{ click: 'a', foo: 1 }] }] }).some((e) => e.includes('unknown key')));
  check('type without text fails', validateSpec({ ...good, steps: [{ id: 'a', say: ['x'], do: [{ type: '#q' }] }] }).some((e) => e.includes('"text"')));
  check('duplicate id fails', validateSpec({ ...good, steps: [good.steps[0], good.steps[0]] }).some((e) => e.includes('duplicate')));
  check('bad id fails', validateSpec({ ...good, steps: [{ id: 'Intro Step', say: ['x'] }] }).some((e) => e.includes('kebab-case')));
  check('empty line fails', validateSpec({ ...good, steps: [{ id: 'a', say: ['  '] }] }).some((e) => e.includes('empty line')));
  check('negative wait fails', validateSpec({ ...good, steps: [{ id: 'a', say: ['x'], do: [{ wait: -1 }] }] }).some((e) => e.includes('milliseconds')));

  check('speech uses speak override', lineSpeech(good.steps[1].say[0]) === 'Dash zero rocks.');
  check('subtitle uses text', lineText(good.steps[1].say[0]) === 'Dash0 rocks.');
  check('relative url resolves', resolveUrl('https://example.com/app/', '/x?y=1') === 'https://example.com/x?y=1');
  check('absolute url passes through', resolveUrl('https://a.com', 'https://b.com/z') === 'https://b.com/z');
  check('150 words is 60 s', Math.abs(estimateSeconds([Array(150).fill('w').join(' ')]) - 60) < 1e-9);

  const concat = buildConcat([{ file: 'a.jpg', ts: 10.2 }, { file: 'b.jpg', ts: 11 }], 10, 12.5);
  check('first frame stretches back to start', concat.includes("file 'a.jpg'\nduration 1.000"));
  check('last frame runs to end', concat.includes("file 'b.jpg'\nduration 1.500"));
  check('last frame repeated', concat.trimEnd().endsWith("file 'b.jpg'"));

  check('srt time format', srtTime(3723.0456) === '01:02:03,046');
  const srt = buildSrt([{ id: 'a', start: 1 }, { id: 'b', start: 5 }], {
    steps: [
      { id: 'a', lines: [{ text: 'One.', start: 0, end: 1.5 }] },
      { id: 'b', lines: [{ text: 'Two.', start: 0.2, end: 2 }] },
    ],
  });
  check('srt offsets by step start', srt.includes('00:00:05,200 --> 00:00:07,000\nTwo.'));
  check('srt numbers cues', srt.startsWith('1\n00:00:01,000'));

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  console.log(`${checks.length - failed.length}/${checks.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [flag, file] = process.argv.slice(2);
  if (flag === '--self-test') selfTest();
  if (flag === '--validate' && file) {
    const errors = validateSpec(JSON.parse(readFileSync(file, 'utf8')));
    for (const error of errors) console.log(error);
    console.log(errors.length ? `${errors.length} problem(s)` : 'OK');
    process.exit(errors.length ? 1 : 0);
  }
  console.error('usage: node lib.mjs --self-test | --validate <walkthrough.json>');
  process.exit(2);
}
