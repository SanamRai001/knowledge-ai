import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = path.join(root, 'server');
const providerRoot = path.join(serverRoot, 'providers');

function collectTypeScriptFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (fullPath === providerRoot) continue;
      files.push(...collectTypeScriptFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

const forbiddenPatterns = [
  { label: '@google/genai import', pattern: /@google\/genai/ },
  { label: 'GoogleGenAI SDK symbol', pattern: /\bGoogleGenAI\b/ },
];

const findings = [];
for (const file of collectTypeScriptFiles(serverRoot)) {
  const source = fs.readFileSync(file, 'utf8');
  for (const forbidden of forbiddenPatterns) {
    if (forbidden.pattern.test(source)) {
      findings.push({
        file: path.relative(root, file),
        violation: forbidden.label,
      });
    }
  }
}

const requiredProviderFiles = [
  path.join(providerRoot, 'types.ts'),
  path.join(providerRoot, 'geminiProvider.ts'),
  path.join(providerRoot, 'providerRouter.ts'),
];

for (const file of requiredProviderFiles) {
  if (!fs.existsSync(file)) {
    findings.push({
      file: path.relative(root, file),
      violation: 'required provider boundary file is missing',
    });
  }
}

if (findings.length > 0) {
  console.error('LLM provider boundary violations found:');
  for (const finding of findings) {
    console.error(`- ${finding.file}: ${finding.violation}`);
  }
  console.error('Vendor SDK usage must stay inside server/providers/.');
  process.exit(1);
}

console.log('LLM provider boundary guard passed: vendor SDK usage is isolated to server/providers/.');
