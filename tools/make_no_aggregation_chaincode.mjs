import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const toolDir = path.dirname(__filename);
const experimentsDir = path.resolve(toolDir, '..', '..');
const sourcePath = path.join(experimentsDir, 'chaincode.go');
const outDir = path.join(experimentsDir, 'aggregation_trading', 'chaincode_variants');
const withAggregationPath = path.join(outDir, 'chaincode_with_aggregation.go');
const noAggregationPath = path.join(outDir, 'chaincode_no_aggregation.go');

const source = fs.readFileSync(sourcePath, 'utf8');

const start = source.indexOf('\t// ============================ Aggregation ==============================');
const end = source.indexOf('\tvar transactionQueue []Transaction', start);

if (start < 0 || end < 0) {
  throw new Error('Could not locate the Aggregation block in chaincode.go');
}

const replacement = `\t// ============================ Aggregation disabled ==============================\n`
  + `\t// No-aggregation baseline: keep all sell requests independent and only sort by price.\n`
  + `\tsort.Slice(sellQueue, func(i, j int) bool {\n`
  + `\t\treturn sellQueue[i].Price < sellQueue[j].Price\n`
  + `\t})\n\n`;

const noAggregation = source.slice(0, start) + replacement + source.slice(end);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(withAggregationPath, source, 'utf8');
fs.writeFileSync(noAggregationPath, noAggregation, 'utf8');

console.log(`Wrote ${withAggregationPath}`);
console.log(`Wrote ${noAggregationPath}`);
