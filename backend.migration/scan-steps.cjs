const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  fs.readdirSync(dir).forEach(f => {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) results = results.concat(walk(fp));
    else if (f.endsWith('.step.ts')) results.push(fp);
  });
  return results;
}

const steps = walk('src/steps');
steps.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const pathMatch = content.match(/path:\s*['"]([^'"]+)['"]/);
  const methodMatch = content.match(/method:\s*['"]([^'"]+)['"]/);
  const nameMatch = content.match(/name:\s*['"]([^'"]+)['"]/);
  const typeMatch = content.match(/type:\s*['"]([^'"]+)['"]/);
  const rel = path.relative('src/steps', f);
  const method = methodMatch ? methodMatch[1] : (typeMatch ? typeMatch[1] : 'EVENT');
  const apiPath = pathMatch ? pathMatch[1] : 'N/A';
  const name = nameMatch ? nameMatch[1] : '?';
  console.log(`${rel} | ${method} ${apiPath} | ${name}`);
});
