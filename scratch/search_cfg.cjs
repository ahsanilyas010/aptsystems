const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\Admin\\Desktop\\04 - Distribution\\Claude crm webapp and ridder\\files\\APT_GAS_API_v2.gs', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('getSheetByName')) {
    console.log(`L${idx + 1}: ${line.trim()}`);
  }
});
