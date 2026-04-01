/**
 * Generates the Bubblewrap TWA Android project from twa/twa-manifest.json
 * without any interactive prompts. Safe to re-run — overwrites existing files.
 *
 * Usage: node scripts/generate-android-project.mjs
 *
 * Requires @bubblewrap/cli to be installed globally:
 *   npm install -g @bubblewrap/cli
 */

import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const twaDir = resolve(projectRoot, 'twa');

// Resolve @bubblewrap/core from the globally installed CLI
const globalNodeModules = execSync('npm root -g').toString().trim();
const corePath = resolve(globalNodeModules, '@bubblewrap/cli/node_modules/@bubblewrap/core');

const require = createRequire(import.meta.url);
const { TwaManifest, TwaGenerator, ConsoleLog } = require(corePath);

const log = new ConsoleLog('generate');
log.info(`Reading twa-manifest.json from ${twaDir}`);
const twaManifest = await TwaManifest.fromFile(resolve(twaDir, 'twa-manifest.json'));

log.info('Generating Android TWA project into twa/...');
const generator = new TwaGenerator();
await generator.createTwaProject(twaDir, twaManifest, log);
log.info('Done. Android project files written to twa/');
