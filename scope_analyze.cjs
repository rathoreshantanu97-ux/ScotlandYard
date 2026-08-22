const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const GLOBALS = new Set([
  'window','document','console','Math','JSON','fetch','localStorage','sessionStorage',
  'setTimeout','clearTimeout','setInterval','clearInterval','Promise','Array','Object',
  'String','Number','Boolean','Date','RegExp','Error','TypeError','RangeError','Map','Set',
  'WeakMap','WeakSet','Symbol','Proxy','Reflect','Infinity','NaN','undefined','globalThis',
  'navigator','location','history','requestAnimationFrame','cancelAnimationFrame','process',
  'Buffer','__dirname','__filename','require','module','exports','global','structuredClone',
  'FormData','URL','URLSearchParams','Blob','File','FileReader','Image','Audio','WebSocket',
  'XMLHttpRequest','Headers','Request','Response','AbortController','crypto','performance',
  'MutationObserver','ResizeObserver','IntersectionObserver','CustomEvent','Event','EventTarget',
  'getComputedStyle','matchMedia','alert','confirm','prompt','btoa','atob','encodeURIComponent',
  'decodeURIComponent','encodeURI','decodeURI','isNaN','isFinite','parseInt','parseFloat',
  'queueMicrotask','self','top','parent','frames','name','__webpack_require__','import',
]);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(p, out);
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      out.push(p);
    }
  }
}

const files = [];
walk(process.argv[2] || './src', files);

let totalIssues = 0;
for (const file of files) {
  const code = fs.readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx'],
    });
  } catch (e) {
    console.log(`PARSE_ERROR ${file}: ${e.message}`);
    totalIssues++;
    continue;
  }
  traverse(ast, {
    Program(path) {
      const globals = path.scope.globals;
      for (const name of Object.keys(globals)) {
        if (GLOBALS.has(name)) continue;
        const refs = globals[name];
        const ref = Array.isArray(refs) ? refs[0] : refs;
        const loc = ref && ref.loc ? ref.loc.start : (ref && ref.node && ref.node.loc ? ref.node.loc.start : null);
        console.log(`UNDEFINED ${file}:${loc ? loc.line : '?'} -> ${name}`);
        totalIssues++;
      }
    },
  });
}
console.log(`\nfiles=${files.length} issues=${totalIssues}`);
