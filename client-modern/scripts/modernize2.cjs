// Pass 2: structural polish of class strings (rounded boxes, banners, plain-table cell padding). Idempotent-ish; run once.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'src');
const targets = ['screens', 'components/finance', 'components/inventory', 'components/purchase', 'components/reports', 'components/sales'];
const skip = (p) => /screens[\/]home[\/]/.test(p) || /PlaceholderScreen/.test(p);
function walk(d, out = []) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p, out); else if (/\.tsx$/.test(f.name)) out.push(p); } return out; }
const stats = { boxes: 0, cards: 0, banners: 0, cells: 0 };
function fixClass(s, ctx) {
  const t = s.split(/\s+/).filter(Boolean);
  if (!t.length) return s;
  const has = (x) => t.includes(x);
  const isGrid = t.some((x) => /^grid-t[dh]$/.test(x)) || has('!p-0');
  // plain table cells
  if (ctx === 'cell' && !isGrid) {
    let ch = false;
    const n = t.map((x) => { if (x === 'px-2') { ch = true; return 'px-3'; } if (x === 'py-1') { ch = true; return 'py-2'; } if (x === 'py-0.5') { ch = true; return 'py-1.5'; } return x; });
    if (ch) { stats.cells++; return n.join(' '); }
    return s;
  }
  if (has('border') && !t.some((x) => /^rounded/.test(x)) && !t.some((x) => /^(border-[btlrxy]|border-t-2)$/.test(x))) {
    const soft = t.some((x) => /^bg-(danger|warning|success|info|brand)-soft$/.test(x));
    const surf = has('bg-surface') || has('bg-surface-2');
    if (soft && !t.includes('absolute')) {
      stats.banners++;
      return t.map((x) => (x === 'px-2' ? 'px-3' : x === 'px-3' ? 'px-3' : x === 'py-1' || x === 'py-1.5' ? 'py-2' : x)).join(' ') + ' rounded-lg';
    }
    if (surf && (t.includes('px-3') || t.includes('p-2') || t.includes('p-3') || t.includes('px-2') || t.some((x) => /^py-/.test(x)))) { stats.cards++; return t.map((x) => (x === 'py-1.5' || x === 'py-1' ? 'py-2' : x === 'p-2' ? 'p-3' : x)).join(' ') + ' rounded-card shadow-card'; }
    if (surf) { stats.boxes++; return t.join(' ') + ' rounded-lg'; }
  }
  return s;
}
let files = 0;
for (const tg of targets) for (const f of walk(path.join(root, tg))) {
  if (skip(f)) continue;
  const o = fs.readFileSync(f, 'utf8');
  let s = o;
  // table cells: <th|td ... className="...">
  s = s.replace(/(<(?:th|td)\b[^>]*?className=")([^"]*)(")/g, (m, a, c, b) => a + fixClass(c, 'cell') + b);
  // any className="..." / string with border + bg
  s = s.replace(/className="([^"{}<>]*)"/g, (m, c) => 'className="' + fixClass(c) + '"');
  s = s.replace(/'([^'{}<>\n]*\bborder\b[^'{}<>\n]*)'/g, (m, c) => (/\bbg-/.test(c) ? "'" + fixClass(c) + "'" : m));
  if (s !== o) { files++; fs.writeFileSync(f, s); }
}
console.log(files, stats);
