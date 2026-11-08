import fs from 'node:fs';
import * as t from '../src/sequentialTemplates.js';
const entries = Object.entries(t);
let out = '# Generated from frontend/src/sequentialTemplates.js by frontend/scripts/gen-python-templates.mjs. Do not edit by hand.\n';
for (const [name, value] of entries) {
  if (value.includes("'''")) throw new Error(name + ' contains a triple quote');
  out += name + " = r'''" + value + "'''\n";
}
fs.writeFileSync(new URL('../../backend/sequential_templates.py', import.meta.url), out);
console.log('wrote', entries.length, 'templates');

// BeeRus note types for the default settings: the Python backend loads this when the request carries no theme.
const { buildThemePayload, DEFAULT_SETTINGS } = await import('../src/beerus.js');
fs.writeFileSync(new URL('../../backend/beerus_default_theme.json', import.meta.url), JSON.stringify(buildThemePayload(DEFAULT_SETTINGS)));
console.log('wrote beerus_default_theme.json');
