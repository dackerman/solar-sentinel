// Simple JavaScript syntax checker
const fs = require('fs');

try {
  const html = fs.readFileSync('./public/index.html', 'utf8');
  const scriptMatch = html.match(/<script>(.*?)<\/script>/s);

  if (!scriptMatch) {
    console.log('❌ No script block found');
    process.exit(1);
  }

  const jsCode = scriptMatch[1];

  // Try to parse as JavaScript
  try {
    new Function(jsCode);
    console.log('✅ JavaScript syntax is valid');
  } catch (e) {
    console.log('❌ JavaScript syntax error:', e.message);
    console.log('Error around line:', e.lineNumber || 'unknown');
    process.exit(1);
  }

  // Check function order
  const functions = ['updateDebugPanel', 'logDebug', 'loadUVData'];
  let lastIndex = -1;

  functions.forEach(func => {
    const index = jsCode.indexOf(`function ${func}`) || jsCode.indexOf(`async function ${func}`);
    if (index === -1) {
      console.log(`⚠️ Function ${func} not found as function declaration`);
    } else if (index < lastIndex) {
      console.log(`⚠️ Function ${func} defined after a function that calls it`);
    } else {
      console.log(`✅ Function ${func} found at position ${index}`);
      lastIndex = index;
    }
  });
} catch (e) {
  console.log('❌ Error reading file:', e.message);
  process.exit(1);
}
