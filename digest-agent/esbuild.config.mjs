// esbuild orchestration for the Electron app.
// Bundles the main process, the preload script, and each renderer entry.
// Native modules (better-sqlite3, electron) stay external — Electron resolves them at runtime.

import { build, context } from 'esbuild';
import { readdirSync, statSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, basename, relative } from 'node:path';

const watch = process.argv.includes('--watch');

const externals = [
  'electron',
  'better-sqlite3',
  'fsevents',
  '@blackglory/better-sqlite3-migrations',
  'jsonc-parser',
  'fastify',
  '@modelcontextprotocol/sdk',
  // OpenTelemetry + Langfuse: their transitive CJS deps use `require('util')`,
  // `require('fs')`, etc., which esbuild's ESM bundle can't resolve at runtime
  // ("Dynamic require of X is not supported"). Externalize so Node loads them
  // from node_modules instead of inlining them into the bundle.
  '@opentelemetry/*',
  '@langfuse/*',
];

/** @type {import('esbuild').BuildOptions} */
const sharedOptions = {
  bundle: true,
  minify: false,
  sourcemap: true,
  target: 'node22',
  format: 'esm',
  external: externals,
  logLevel: 'info',
  alias: {
    '@shared': './src/shared',
  },
};

const tasks = [
  // Main process — pure Node.
  {
    ...sharedOptions,
    entryPoints: ['src/main/index.ts'],
    outfile: 'dist/main/index.js',
    platform: 'node',
  },
  // Substrate MCP server — runs as a subprocess of main, spawned by Phase 8's dispatchers.
  {
    ...sharedOptions,
    entryPoints: ['src/main/mcp/substrate/server.ts'],
    outfile: 'dist/main/mcp/substrate/server.js',
    platform: 'node',
  },
  // Surface MCP server — runs as a subprocess of the principal's Claude Code.
  {
    ...sharedOptions,
    entryPoints: ['src/main/mcp/surface/server.ts'],
    outfile: 'dist/main/mcp/surface/server.js',
    platform: 'node',
  },
  // Persona-* MCP servers — test mode only. Three subprocesses spawned by the
  // mind / diary / cold-start Claude Code agents to read persona.db with
  // rich, Gmail/Calendar/Notes-shaped tool surfaces. In production these are
  // replaced by the user's real third-party MCPs.
  {
    ...sharedOptions,
    entryPoints: ['src/main/mcp/personaEmail/server.ts'],
    outfile: 'dist/main/mcp/personaEmail/server.js',
    platform: 'node',
  },
  {
    ...sharedOptions,
    entryPoints: ['src/main/mcp/personaCalendar/server.ts'],
    outfile: 'dist/main/mcp/personaCalendar/server.js',
    platform: 'node',
  },
  {
    ...sharedOptions,
    entryPoints: ['src/main/mcp/personaNotes/server.ts'],
    outfile: 'dist/main/mcp/personaNotes/server.js',
    platform: 'node',
  },
];

// Renderer entries — auto-discovered. Each subdirectory under src/renderer/
// that contains a `view.ts` becomes its own bundle. Renderer bundles use
// the IIFE format so they can be loaded directly via a <script> tag.
const rendererRoot = 'src/renderer';
const staticAssets = []; // collected paths to copy after the build
if (existsSync(rendererRoot)) {
  for (const name of readdirSync(rendererRoot)) {
    const subdir = join(rendererRoot, name);
    let isDir = false;
    try {
      isDir = statSync(subdir).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) continue;

    const entry = join(subdir, 'view.ts');
    try {
      if (statSync(entry).isFile()) {
        tasks.push({
          ...sharedOptions,
          entryPoints: [entry],
          outfile: join('dist/renderer', name, 'view.js'),
          platform: 'browser',
          format: 'iife',
          external: [], // renderer bundles inline all deps
          loader: { '.css': 'css', '.svg': 'text' },
        });
      }
    } catch {
      // No view.ts; skip the bundle but still copy assets.
    }

    // Collect static assets to copy (HTML files + any svg under illustrations/).
    walk(subdir, (p) => {
      if (p.endsWith('.html')) staticAssets.push(p);
      if (p.endsWith('.svg')) staticAssets.push(p);
    });
  }
}

function walk(root, visit) {
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, visit);
    else visit(full);
  }
}

// Preload script — runs in a privileged context with Node APIs but compiled
// for renderer-style consumption. Keep as CJS for contextBridge compatibility.
const preloadEntry = join(rendererRoot, 'preload.ts');
try {
  if (statSync(preloadEntry).isFile()) {
    tasks.push({
      ...sharedOptions,
      entryPoints: [preloadEntry],
      // .cjs extension forces Node to treat the file as CommonJS regardless
      // of the project's `"type": "module"` in package.json. Without this,
      // Electron tries to load the CJS bundle as ESM and `contextBridge`
      // never exposes `window.digest` to the renderer.
      outfile: 'dist/renderer/preload.cjs',
      platform: 'browser',
      format: 'cjs',
      external: ['electron'],
    });
  }
} catch {
  // No preload yet; skip.
}

mkdirSync('dist', { recursive: true });

function copyStaticAssets() {
  for (const src of staticAssets) {
    const dest = join('dist', relative('src', src));
    mkdirSync(join(dest, '..'), { recursive: true });
    copyFileSync(src, dest);
  }
}

if (watch) {
  for (const task of tasks) {
    const ctx = await context(task);
    await ctx.watch();
    console.log(`[esbuild] watching ${task.entryPoints[0]} → ${task.outfile}`);
  }
  copyStaticAssets();
} else {
  for (const task of tasks) {
    await build(task);
  }
  copyStaticAssets();
  console.log(`[esbuild] built ${tasks.length} bundle(s), copied ${staticAssets.length} static asset(s)`);
}
