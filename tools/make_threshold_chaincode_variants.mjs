import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const toolDir = path.dirname(__filename);
const experimentsDir = path.resolve(toolDir, '..', '..');
const sourcePath = path.join(experimentsDir, 'chaincode.go');
const outDir = path.join(experimentsDir, 'aggregation_trading', 'chaincode_variants');
const thresholds = [2000, 4000, 6000];

const source = fs.readFileSync(sourcePath, 'utf8');
fs.mkdirSync(outDir, { recursive: true });

for (const threshold of thresholds) {
  const replaced = source.replace(
    /const Saggregation = [0-9.]+/,
    `const Saggregation = ${threshold}.0`,
  );
  if (replaced === source && threshold !== 4000) {
    throw new Error('Could not replace Saggregation threshold in chaincode.go');
  }

  const outPath = path.join(outDir, `chaincode_with_aggregation_threshold_${threshold}.go`);
  fs.writeFileSync(outPath, replaced, 'utf8');
  console.log(`Wrote ${outPath}`);
}
