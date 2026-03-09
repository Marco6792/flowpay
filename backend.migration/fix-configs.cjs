const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

function walk(dir) {
  let results = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) results.push(...walk(full));
    else if (full.endsWith('.step.ts')) results.push(full);
  }
  return results;
}

let fixedEmits = 0;
let fixedParams = 0;
let fixedQuery = 0;

for (const file of walk(srcDir)) {
  let content = fs.readFileSync(file, 'utf8');
  let modified = false;
  const basename = path.basename(file);

  // Fix 1: Remove paramsSchema from config
  // Match "  paramsSchema,\n" or "  paramsSchema: paramsSchema,\n"
  if (content.match(/^\s+paramsSchema[,\s]*$/m) && content.includes('const config')) {
    content = content.replace(/^\s+paramsSchema,?\n/m, '');
    fixedParams++;
    modified = true;
    console.log(`Removed paramsSchema: ${basename}`);
  }

  // Fix 2: Remove querySchema from config
  if (content.match(/^\s+querySchema[,\s]*$/m) && content.includes('const config')) {
    content = content.replace(/^\s+querySchema,?\n/m, '');
    fixedQuery++;
    modified = true;
    console.log(`Removed querySchema: ${basename}`);
  }

  // Fix 3: Add emits: [] if missing
  // Only for API and event step configs
  if (content.includes("type: 'api'") || content.includes("type: 'event'")) {
    // Check if emits is already present in the config
    // Find the config block and check for emits
    const configMatch = content.match(/export const config[^=]*=\s*\{[\s\S]*?\n\}/);
    if (configMatch) {
      const configBlock = configMatch[0];
      if (!configBlock.includes('emits')) {
        // Add emits: [] before the description or middleware line, or at end
        // Strategy: add it after the method line for API, after subscribes for event
        if (content.includes("type: 'api'")) {
          // Add emits: [] after method line
          content = content.replace(
            /(method:\s*'[A-Z]+',?\n)/,
            '$1  emits: [],\n'
          );
        } else if (content.includes("type: 'event'")) {
          // Add emits: [] after subscribes
          content = content.replace(
            /(subscribes:\s*\[[\s\S]*?\],?\n)/,
            '$1  emits: [],\n'
          );
        }
        fixedEmits++;
        modified = true;
        console.log(`Added emits: []: ${basename}`);
      }
    }
  }

  if (modified) {
    fs.writeFileSync(file, content, 'utf8');
  }
}

console.log(`\nSummary:`);
console.log(`  Added emits: ${fixedEmits}`);
console.log(`  Removed paramsSchema: ${fixedParams}`);
console.log(`  Removed querySchema: ${fixedQuery}`);
console.log(`  Total modifications: ${fixedEmits + fixedParams + fixedQuery}`);
