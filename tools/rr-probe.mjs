#!/usr/bin/env node
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_EXE = join(REPO_ROOT, 'src-tauri', 'target', 'debug', 'RapidRAW.exe');

const USAGE = `Usage:
  node tools/rr-probe.mjs render <image> [--set key=value]... [--adjustments file.json] [--reset]
                                 [--out file.png] [--size 1600] [--crop WxH+X+Y] [--keep-full]
  node tools/rr-probe.mjs meta <image>
  node tools/rr-probe.mjs diff <a> <b> [--out heatmap.png] [--gain 8] [--fuzz 0.5]

Options:
  --exe <path>   RapidRAW executable (default: $RR_EXE or src-tauri/target/debug/RapidRAW.exe)`;

function parseArgs(argv) {
  const positional = [];
  const options = { set: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === 'reset' || key === 'keep-full') {
      options[key] = true;
    } else if (key === 'set') {
      options.set.push(argv[++i]);
    } else {
      options[key] = argv[++i];
    }
  }
  return { positional, options };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function resolveExe(options) {
  const exe = options.exe ?? process.env.RR_EXE ?? DEFAULT_EXE;
  if (!existsSync(exe)) fail(`RapidRAW executable not found: ${exe}`);
  return exe;
}

function runExe(exe, args) {
  const started = performance.now();
  const result = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const elapsedMs = Math.round(performance.now() - started);
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    fail(`${basename(exe)} ${args[0]} failed with exit code ${result.status}`);
  }
  return { stdout: result.stdout, elapsedMs };
}

function magick(args) {
  return execFileSync('magick', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

function compareMetric(args) {
  const result = spawnSync('magick', ['compare', ...args, 'null:'], { encoding: 'utf8' });
  if (result.status > 1) fail(`magick compare failed: ${result.stderr}`);
  const output = result.stderr.trim();
  return Number(output.match(/\(([^)]+)\)/)?.[1] ?? output.split(' ')[0]);
}

function parseValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function setPath(target, path, value) {
  const keys = path.split('.');
  let node = target;
  for (const key of keys.slice(0, -1)) {
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
    node = node[key];
  }
  node[keys.at(-1)] = value;
}

function loadBaseAdjustments(image, options) {
  if (options.adjustments) {
    const json = JSON.parse(readFileSync(options.adjustments, 'utf8'));
    return json.adjustments ?? json;
  }
  if (options.reset) return {};
  const sidecar = `${image}.rrdata`;
  return existsSync(sidecar) ? (JSON.parse(readFileSync(sidecar, 'utf8')).adjustments ?? {}) : {};
}

function render(image, options) {
  if (!image) fail(USAGE);
  if (!existsSync(image)) fail(`Image not found: ${image}`);
  const exe = resolveExe(options);
  const out = resolve(options.out ?? join(tmpdir(), 'rr-probe', `${basename(image, extname(image))}.png`));
  const stem = out.slice(0, -extname(out).length);
  const full = `${stem}.full.png`;
  mkdirSync(dirname(out), { recursive: true });

  const args = ['export', resolve(image), '--output', full, '--format', 'png'];
  const overridden = options.set.length > 0 || options.adjustments || options.reset;
  if (overridden) {
    const adjustments = loadBaseAdjustments(image, options);
    for (const entry of options.set) {
      const eq = entry.indexOf('=');
      if (eq < 1) fail(`Invalid --set '${entry}', expected key=value`);
      setPath(adjustments, entry.slice(0, eq), parseValue(entry.slice(eq + 1)));
    }
    const adjustmentsFile = `${stem}.adjustments.json`;
    writeFileSync(adjustmentsFile, JSON.stringify(adjustments, null, 2));
    args.push('--adjustments', adjustmentsFile);
  }

  const { elapsedMs } = runExe(exe, args);
  const [width, height] = magick(['identify', '-format', '%w %h', full]).split(' ').map(Number);
  const size = Number(options.size ?? 1600);
  if (size > 0) {
    magick([full, '-resize', `${size}x${size}>`, out]);
  } else {
    magick([full, out]);
  }

  const outputs = { preview: out };
  if (options.crop) {
    outputs.crop = `${stem}.crop.png`;
    magick([full, '-crop', options.crop, '+repage', outputs.crop]);
  }
  if (options['keep-full']) {
    outputs.full = full;
  } else {
    rmSync(full);
  }
  if (overridden) outputs.adjustments = `${stem}.adjustments.json`;

  console.log(
    JSON.stringify(
      {
        image: resolve(image),
        adjustments: overridden ? 'override' : 'sidecar',
        renderMs: elapsedMs,
        renderSize: [width, height],
        exe,
        exeBuilt: statSync(exe).mtime.toISOString(),
        outputs,
      },
      null,
      2,
    ),
  );
}

function meta(image, options) {
  if (!image) fail(USAGE);
  if (!existsSync(image)) fail(`Image not found: ${image}`);
  const { stdout } = runExe(resolveExe(options), ['probe', 'meta', resolve(image)]);
  process.stdout.write(stdout);
}

function channelMeans(file) {
  return magick(['identify', '-format', '%[fx:mean.r*255] %[fx:mean.g*255] %[fx:mean.b*255]', file])
    .split(' ')
    .map(Number);
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function diff(a, b, options) {
  if (!a || !b) fail(USAGE);
  for (const file of [a, b]) if (!existsSync(file)) fail(`Image not found: ${file}`);
  const sizeA = magick(['identify', '-format', '%wx%h', a]);
  const sizeB = magick(['identify', '-format', '%wx%h', b]);
  if (sizeA !== sizeB) fail(`Size mismatch: ${sizeA} vs ${sizeB}`);

  const absolute = magick([
    a,
    b,
    '-compose',
    'difference',
    '-composite',
    '-format',
    '%[fx:mean.r*255] %[fx:mean.g*255] %[fx:mean.b*255] %[fx:maxima.r*255] %[fx:maxima.g*255] %[fx:maxima.b*255]',
    'info:',
  ])
    .split(' ')
    .map(Number);
  const meansA = channelMeans(a);
  const meansB = channelMeans(b);
  const fuzz = options.fuzz ?? '0.5';
  const changed = compareMetric(['-metric', 'AE', '-fuzz', `${fuzz}%`, a, b]);
  const rmse = compareMetric(['-metric', 'RMSE', a, b]) * 255;
  const [w, h] = sizeA.split('x').map(Number);

  const result = {
    size: sizeA,
    meanAbsDiff: { r: round(absolute[0]), g: round(absolute[1]), b: round(absolute[2]) },
    maxAbsDiff: { r: round(absolute[3], 1), g: round(absolute[4], 1), b: round(absolute[5], 1) },
    meanShiftBminusA: {
      r: round(meansB[0] - meansA[0]),
      g: round(meansB[1] - meansA[1]),
      b: round(meansB[2] - meansA[2]),
    },
    changedPixels: { fuzzPercent: Number(fuzz), count: changed, percent: round((changed / (w * h)) * 100, 2) },
    rmse: round(rmse),
  };

  if (options.out) {
    mkdirSync(dirname(resolve(options.out)), { recursive: true });
    magick([
      a,
      b,
      '-compose',
      'difference',
      '-composite',
      '-colorspace',
      'gray',
      '-evaluate',
      'multiply',
      String(options.gain ?? 8),
      resolve(options.out),
    ]);
    result.heatmap = resolve(options.out);
  }

  console.log(JSON.stringify(result, null, 2));
}

const [command, ...rest] = process.argv.slice(2);
const { positional, options } = parseArgs(rest);

switch (command) {
  case 'render':
    render(positional[0], options);
    break;
  case 'meta':
    meta(positional[0], options);
    break;
  case 'diff':
    diff(positional[0], positional[1], options);
    break;
  default:
    fail(USAGE);
}
