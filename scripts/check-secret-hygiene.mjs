import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const root = process.cwd();
const maxFileSizeBytes = 2 * 1024 * 1024;

const patterns = [
  { name: 'Google API key', regex: /AIza[0-9A-Za-z_-]{30,}/g },
  { name: 'OpenAI-style API key', regex: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: 'Anthropic API key', regex: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'GitHub token', regex: /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})/g },
  { name: 'AWS access key', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'Slack token', regex: /xox[baprs]-[A-Za-z0-9-]{20,}/g },
  { name: 'Knowledge AI raw API key', regex: /kn_(?:live|test)_[a-f0-9]{24,}/gi },
  { name: 'Private key material', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

// Exact deterministic fixtures used by legacy sanitizer tests. Keep this list tiny and
// exact-value only: arbitrary credential-shaped strings must still fail the guard.
const knownSyntheticFixtures = new Set([
  'AIza' + 'SyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6',
]);

const forbiddenRuntimeFiles = new Set([
  'data/api_keys.json',
  'data/api_usage.json',
  'data/knowledge_bases.json',
  'data/memory_learning.json',
]);

let trackedFiles = [];
try {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  trackedFiles = output.split('\0').filter(Boolean);
} catch (error) {
  console.error('SECRET_HYGIENE_CHECK_FAILED: unable to enumerate tracked Git files.');
  console.error(error);
  process.exit(1);
}

const findings = [];

for (const relative of trackedFiles) {
  if (forbiddenRuntimeFiles.has(relative)) {
    findings.push({ file: relative, type: 'Mutable runtime state is tracked by Git', preview: 'runtime-state' });
    continue;
  }

  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue;

  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > maxFileSizeBytes) continue;

  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    for (const match of content.matchAll(pattern.regex)) {
      if (knownSyntheticFixtures.has(match[0])) continue;
      findings.push({
        file: relative,
        type: pattern.name,
        preview: `${match[0].slice(0, 8)}…${match[0].slice(-4)}`,
      });
    }
  }
}

if (findings.length > 0) {
  console.error('SECRET_HYGIENE_CHECK_FAILED');
  for (const finding of findings) {
    console.error(`- ${finding.file}: ${finding.type} (${finding.preview})`);
  }
  process.exit(1);
}

console.log('SECRET_HYGIENE_CHECK_PASSED');
console.log(`Scanned ${trackedFiles.length} tracked files; no known raw credential patterns or forbidden runtime state detected.`);
