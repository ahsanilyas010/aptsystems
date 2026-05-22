const fs = require('fs');
const path = require('path');

function searchAllGs(dir) {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        searchAllGs(fullPath);
      } else if (file.endsWith('.gs')) {
        console.log(`Found GS File: ${fullPath}`);
      }
    }
  } catch (e) {}
}

searchAllGs('C:\\Users\\Admin\\.gemini\\antigravity\\brain');
