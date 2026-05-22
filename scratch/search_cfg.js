const fs = require('fs');
const path = require('path');

function searchWorkspace(dir, query) {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (file !== 'node_modules' && file !== '.git') {
          searchWorkspace(fullPath, query);
        }
      } else if (file.endsWith('.html') || file.endsWith('.gs') || file.endsWith('.js') || file.endsWith('.jsx')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes(query)) {
          const lines = content.split('\n');
          lines.forEach((line, idx) => {
            if (line.includes(query) && line.length < 500) {
              console.log(`${file} L${idx + 1}: ${line.trim()}`);
            }
          });
        }
      }
    }
  } catch (e) {}
}

console.log("Searching in workspace...");
searchWorkspace('c:\\Users\\Admin\\Desktop\\04 - Distribution\\Claude crm webapp and ridder\\files', 'CFG =');
searchWorkspace('c:\\Users\\Admin\\Desktop\\04 - Distribution\\Claude crm webapp and ridder\\files', 'CFG:');
searchWorkspace('c:\\Users\\Admin\\Desktop\\04 - Distribution\\Claude crm webapp and ridder\\files', 'INV_I');
