import fs from 'fs';
import crypto from 'crypto';

const file =
  process.env.H4_SBOM_PATH ||
  'knowledge-ai.sbom.cdx.json';

if (!fs.existsSync(file)) {
  throw new Error(
    'H4 SBOM file is missing: ' +
      file
  );
}

const bytes =
  fs.readFileSync(file);
const parsed =
  JSON.parse(
    bytes.toString('utf8')
  );

if (
  parsed.bomFormat !==
    'CycloneDX' ||
  typeof parsed.specVersion !==
    'string' ||
  !Array.isArray(
    parsed.components
  )
) {
  throw new Error(
    'H4 SBOM must be valid CycloneDX JSON with a components array.'
  );
}

const digest =
  crypto
    .createHash('sha256')
    .update(bytes)
    .digest('hex');

if (
  !/^[0-9a-f]{64}$/.test(
    digest
  )
) {
  throw new Error(
    'H4 SBOM SHA-256 generation failed.'
  );
}

console.log(
  JSON.stringify({
    valid: true,
    format: parsed.bomFormat,
    specVersion:
      parsed.specVersion,
    componentCount:
      parsed.components.length,
    sha256: digest,
  })
);
