#!/usr/bin/env node
// Drives a real browser through walkthrough.json and captures it frame by frame.
// Requires: node >= 18, playwright with Chromium.
//
//   node record.mjs <walkthrough.json> [--check] [--headed] [--playwright-from <dir>] [--out <dir>]
//
// --check runs setup and every action as fast as possible with no capture and no narration holds,
// and prints one line per action, so a broken selector costs seconds instead of a full take.
// Without --check it writes <out>/frames/*.jpg, <out>/frames.json, and <out>/timeline.json.
// <out> defaults to the folder holding walkthrough.json.

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULTS, estimateSeconds, resolveUrl, validateSpec, verbOf } from './lib.mjs';

const RUNTIME_DIR = path.join(os.homedir(), '.cache', 'narrated-walkthrough', 'node');
// Chromium screencast JPEG quality; 92 keeps small UI text free of visible ringing.
const JPEG_QUALITY = 92;
const ACTION_TIMEOUT_MS = 15_000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const specPath = args.find((arg, index) => !arg.startsWith('--') && !['--playwright-from', '--out'].includes(args[index - 1]));
if (!specPath) {
  console.error('usage: node record.mjs <walkthrough.json> [--check] [--headed] [--playwright-from <dir>] [--out <dir>]');
  process.exit(2);
}

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const problems = validateSpec(spec);
if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exit(2);
}

const specDir = path.dirname(path.resolve(specPath));
const outDir = path.resolve(option('--out') ?? specDir);
const checkOnly = flag('--check');

function loadPlaywright() {
  const roots = [option('--playwright-from'), process.cwd(), specDir, RUNTIME_DIR].filter(Boolean);
  for (const root of roots) {
    try {
      return createRequire(path.join(path.resolve(root), 'noop.js'))('playwright');
    } catch {
      // try the next root
    }
  }
  console.error(`ERROR: playwright not found from ${roots.join(', ')}`);
  console.error(`Install it once into the skill runtime: npm --prefix ${RUNTIME_DIR} install playwright && npx --prefix ${RUNTIME_DIR} playwright install chromium`);
  process.exit(3);
}

function narrationSeconds() {
  const manifestPath = path.join(specDir, 'audio', 'manifest.json');
  const durations = new Map();
  if (existsSync(manifestPath)) {
    for (const step of JSON.parse(readFileSync(manifestPath, 'utf8')).steps) durations.set(step.id, step.duration);
  }
  const missing = spec.steps.filter((step) => !durations.has(step.id)).map((step) => step.id);
  if (missing.length && !checkOnly) {
    console.error(`WARN: no audio for ${missing.join(', ')}; holding for an estimated reading time instead`);
  }
  return (step) => durations.get(step.id) ?? estimateSeconds(step.say);
}

// Headless video shows no pointer, so the page draws one; pointer-events: none keeps it out of hit tests.
const CURSOR_SCRIPT = `
(() => {
  if (window.__walkthroughCursor) return;
  window.__walkthroughCursor = true;
  const install = () => {
    const cursor = document.createElement('div');
    cursor.setAttribute('data-walkthrough', 'cursor');
    cursor.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:transform 16ms linear;';
    cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.6 20.5 L13.4 19.2 L10.4 12.6 L16.5 12.6 Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(cursor);
    window.addEventListener('mousemove', (event) => {
      cursor.style.transform = 'translate(' + (event.clientX - 3) + 'px,' + (event.clientY - 2) + 'px)';
    }, true);
    window.addEventListener('mousedown', (event) => {
      const ripple = document.createElement('div');
      ripple.setAttribute('data-walkthrough', 'ripple');
      ripple.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;width:36px;height:36px;border-radius:50%;border:3px solid rgba(80,120,255,.85);left:' + (event.clientX - 18) + 'px;top:' + (event.clientY - 18) + 'px;transition:transform 450ms ease-out,opacity 450ms ease-out;';
      document.documentElement.appendChild(ripple);
      requestAnimationFrame(() => { ripple.style.transform = 'scale(1.8)'; ripple.style.opacity = '0'; });
      setTimeout(() => ripple.remove(), 500);
    }, true);
  };
  if (document.documentElement) install(); else document.addEventListener('DOMContentLoaded', install);
})();
`;

function highlightScript(box, ms) {
  return `(() => {
    const ring = document.createElement('div');
    ring.setAttribute('data-walkthrough', 'highlight');
    ring.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;border-radius:8px;border:3px solid rgba(80,120,255,.9);box-shadow:0 0 0 9999px rgba(0,0,0,.25);transition:opacity 250ms;left:${box.x - 6}px;top:${box.y - 6}px;width:${box.width + 12}px;height:${box.height + 12}px;';
    document.documentElement.appendChild(ring);
    setTimeout(() => { ring.style.opacity = '0'; setTimeout(() => ring.remove(), 300); }, ${ms});
  })()`;
}

const { chromium } = loadPlaywright();
const viewport = spec.viewport ?? DEFAULTS.viewport;
const scale = spec.scale ?? DEFAULTS.scale;
const beatMs = spec.beatMs ?? DEFAULTS.beatMs;
const stepGapMs = spec.stepGapMs ?? DEFAULTS.stepGapMs;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await chromium.launch({ headless: !flag('--headed') });
const contextOptions = { viewport, deviceScaleFactor: scale };
if (spec.colorScheme) contextOptions.colorScheme = spec.colorScheme;
if (spec.storageState) {
  const statePath = path.resolve(specDir, spec.storageState);
  if (!existsSync(statePath)) {
    console.error(`ERROR: storageState ${statePath} does not exist; sign in first and save the state there`);
    await browser.close();
    process.exit(3);
  }
  contextOptions.storageState = statePath;
}
const context = await browser.newContext(contextOptions);
context.setDefaultTimeout(ACTION_TIMEOUT_MS);
const page = await context.newPage();
await page.addInitScript(CURSOR_SCRIPT);

const mouse = { x: viewport.width / 2, y: viewport.height / 2 };

function locate(action, verb) {
  const locator = page.locator(action[verb]);
  return action.nth === undefined ? locator.first() : locator.nth(action.nth);
}

async function glideTo(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('target has no bounding box (hidden?)');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (!checkOnly) {
    const distance = Math.hypot(x - mouse.x, y - mouse.y);
    // About one intermediate point per 12 px reads as a smooth hand movement at 30 fps.
    await page.mouse.move(x, y, { steps: Math.min(40, Math.max(8, Math.round(distance / 12))) });
  }
  mouse.x = x;
  mouse.y = y;
  return box;
}

let cdp;
const frames = [];
const framesDir = path.join(outDir, 'frames');

async function startScreencast() {
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: JPEG_QUALITY,
    maxWidth: Math.round(viewport.width * scale),
    maxHeight: Math.round(viewport.height * scale),
    everyNthFrame: 1,
  });
}

async function perform(action) {
  const verb = verbOf(action);
  switch (verb) {
    case 'goto':
      await page.goto(resolveUrl(spec.baseUrl, action.goto), { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      if (cdp) {
        // A cross-process navigation can end a running screencast; restarting it is harmless otherwise.
        await cdp.send('Page.stopScreencast').catch(() => {});
        await startScreencast();
      }
      break;
    case 'click': {
      const locator = locate(action, verb);
      await glideTo(locator);
      await locator.click();
      break;
    }
    case 'hover': {
      const locator = locate(action, verb);
      await glideTo(locator);
      await locator.hover();
      break;
    }
    case 'type': {
      const locator = locate(action, verb);
      await glideTo(locator);
      await locator.click();
      await page.keyboard.type(action.text, { delay: checkOnly ? 0 : action.delay ?? 60 });
      break;
    }
    case 'fill': {
      const locator = locate(action, verb);
      await glideTo(locator);
      await locator.fill(action.text);
      break;
    }
    case 'press':
      await page.keyboard.press(action.press);
      break;
    case 'select': {
      const locator = locate(action, verb);
      await glideTo(locator);
      await locator.selectOption(action.value);
      break;
    }
    case 'scroll':
      if (typeof action.scroll === 'number') {
        await page.mouse.wheel(0, action.scroll);
      } else {
        await locate(action, verb).evaluate((element) => element.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      }
      if (!checkOnly) await sleep(600);
      break;
    case 'wait':
      if (!checkOnly) await sleep(action.wait);
      break;
    case 'waitFor':
      await locate(action, verb).waitFor({ state: action.state ?? 'visible' });
      break;
    case 'highlight': {
      const box = await glideTo(locate(action, verb));
      const ms = action.ms ?? 1500;
      if (!checkOnly) {
        await page.evaluate(highlightScript(box, ms));
        await sleep(ms);
      }
      break;
    }
  }
  if (!checkOnly && !['wait', 'waitFor'].includes(verb)) await sleep(beatMs);
}

async function runActions(actions, label) {
  for (const [index, action] of actions.entries()) {
    const verb = verbOf(action);
    const started = Date.now();
    try {
      await perform(action);
      if (checkOnly) console.log(`ok   ${label}.do[${index}] ${verb} ${JSON.stringify(action[verb])} (${Date.now() - started} ms)`);
    } catch (error) {
      const shot = path.join(outDir, `failure-${label}-${index}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      console.error(`FAIL ${label}.do[${index}] ${verb} ${JSON.stringify(action[verb])} — ${error.message.split('\n')[0]}`);
      console.error(`     screenshot: ${shot}`);
      await browser.close();
      process.exit(1);
    }
  }
}

mkdirSync(outDir, { recursive: true });
await runActions(spec.setup ?? [], 'setup');

if (checkOnly) {
  for (const step of spec.steps) await runActions(step.do ?? [], step.id);
  console.log(`CHECK OK — ${spec.steps.length} steps`);
  await browser.close();
  process.exit(0);
}

const audioSeconds = narrationSeconds();
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  const file = `frames/${String(frames.length).padStart(6, '0')}.jpg`;
  writeFileSync(path.join(outDir, file), Buffer.from(data, 'base64'));
  frames.push({ file, ts: metadata.timestamp ?? Date.now() / 1000 });
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
// Nudge the cursor so the first frame already shows it.
await page.mouse.move(mouse.x, mouse.y);
await startScreencast();
const t0 = Date.now() / 1000;
await sleep(spec.leadInMs ?? DEFAULTS.leadInMs);

const marks = [];
for (const step of spec.steps) {
  const start = Date.now() / 1000;
  await runActions(step.do ?? [], step.id);
  const actionsEnd = Date.now() / 1000;
  const narration = audioSeconds(step);
  const holdUntil = start + narration + (stepGapMs + (step.holdMs ?? 0)) / 1000;
  await sleep(Math.max(0, (holdUntil - Date.now() / 1000) * 1000));
  const overrun = actionsEnd - (start + narration);
  marks.push({ id: step.id, start: +(start - t0).toFixed(3), actionsEnd: +(actionsEnd - t0).toFixed(3), narration, overrun: +Math.max(0, overrun).toFixed(3) });
}
await sleep(spec.tailMs ?? DEFAULTS.tailMs);
const end = Date.now() / 1000;
await cdp.send('Page.stopScreencast').catch(() => {});
// Let in-flight frames land before the browser goes away.
await sleep(300);
await browser.close();

const capturedFrames = frames.filter((frame) => frame.ts <= end);
writeFileSync(path.join(outDir, 'frames.json'), JSON.stringify(capturedFrames));
writeFileSync(
  path.join(outDir, 'timeline.json'),
  JSON.stringify({ t0, end, duration: +(end - t0).toFixed(3), width: Math.round(viewport.width * scale), height: Math.round(viewport.height * scale), steps: marks }, null, 1),
);

// Actions running more than a second past their narration leave a silent stretch the viewer will notice.
const OVERRUN_WARN_S = 1;
for (const mark of marks.filter((mark) => mark.overrun > OVERRUN_WARN_S)) {
  console.error(`WARN: step ${mark.id} actions ran ${mark.overrun.toFixed(1)} s past its narration; add a line or split the step`);
}
console.log(JSON.stringify({ frames: capturedFrames.length, seconds: +(end - t0).toFixed(1), steps: marks.length, timeline: path.join(outDir, 'timeline.json') }));
