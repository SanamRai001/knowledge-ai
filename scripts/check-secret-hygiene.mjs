import fs from 'fs';
import path from 'path';

const root = process.cwd();
const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'data',
]);

const maxFileSizeBytes = 2 * 1024 * 1024;
const allowedPlaceholderFiles = new Set(['.env.example']);

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

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

const findings = [];

for (const file of walk(root)) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const stat = fs.statSync(file);
  if (stat.size > maxFileSizeBytes) continue;

  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    const matches = [...content.matchAll(pattern.regex)];
    for (const match of matches) {
      // .env.example is allowed to contain names/placeholders, but never a value
      // matching one of the real credential formats above.
      if (allowedPlaceholderFiles.has(relative) && /MY_|your_|example|placeholder/i.test(match[0])) continue;
      findings.push({
        file: relative,
        type: pattern.name,
        preview: `${match[0].slice(0, 8)}…${match[0].slice(-4)}`,
      });
    }
  }
}

const runtimeFiles = [
  'data/api_keys.json',
  'data/api_usage.json',
  'data/knowledge_bases.json',
  'data/memory_learning.json',
];

for (const runtimeFile of runtimeFiles) {
  if (fs.existsSync(path.join(root, runtimeFile))) {
    findings.push({
      file: runtimeFile,
      type: 'Tracked/runtime state present in checkout',
      preview: 'runtime-state',
    });
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
console.log('No known raw credential patterns or tracked runtime state detected in the repository checkout.');
