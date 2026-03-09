const fs = require('fs');
const path = require('path');
const srcDir = path.join(__dirname, 'src');

function walk(dir) {
  let results = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) results.push(...walk(full));
    else if (full.endsWith('.ts')) results.push(full);
  }
  return results;
}

let count = 0;
for (const file of walk(srcDir)) {
  const content = fs.readFileSync(file, 'utf8');
  const pattern = /(from\s+['"]\..*?)\.ts(['"])/g;
  if (pattern.test(content)) {
    // Reset regex lastIndex after test
    pattern.lastIndex = 0;
    const newContent = content.replace(pattern, '$1$2');
    fs.writeFileSync(file, newContent, 'utf8');
    count++;
    console.log('Fixed:', path.relative(srcDir, file));
  }
}
console.log('\nTotal files fixed:', count);
