// Codemod: legacy desktop palette -> modern design tokens. Usage: node scripts/modernize.cjs [--dry]
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'src');
const targets = ['screens', 'components/finance', 'components/inventory', 'components/purchase', 'components/reports', 'components/sales'];
const skip = (p) => /screens[\/]home[\/]/.test(p) || /PlaceholderScreen/.test(p);
const dry = process.argv.includes('--dry');
// [regex, replacement]; applied to class-ish tokens. P = optional variant prefix (hover:, odd:, !, focus: ...)
const P = '((?:[a-z-]+:)*!?)';
const rules = [
  [/odd:bg-white even:bg-slate-50(?:\/\d+)?/g, 'odd:bg-surface even:bg-surface-2'],
  [/odd:bg-white even:bg-app-head/g, 'odd:bg-surface even:bg-surface-2'],
  // semantic status colours
  [String.raw`bg-(?:red|rose)-(?:50|100)(?:\/\d+)?`, 'bg-danger-soft'],
  [String.raw`bg-(?:red|rose)-(?:400|500|600|700)`, 'bg-danger'],
  [String.raw`text-(?:red|rose)-(?:400|500|600|700|800|900)`, 'text-danger'],
  [String.raw`border-(?:red|rose)-(?:100|200|300|400|500|600)`, 'border-danger'],
  [String.raw`bg-(?:green|emerald)-(?:50|100)(?:\/\d+)?`, 'bg-success-soft'],
  [String.raw`bg-(?:green|emerald)-(?:300|400|500|600|700)`, 'bg-success'],
  [String.raw`text-(?:green|emerald)-(?:500|600|700|800|900)`, 'text-success'],
  [String.raw`border-(?:green|emerald)-(?:100|200|300|400|500|600)`, 'border-success'],
  [String.raw`bg-(?:amber|yellow|orange)-(?:50|100)(?:\/\d+)?`, 'bg-warning-soft'],
  [String.raw`bg-(?:amber|yellow|orange)-(?:300|400|500|600)`, 'bg-warning'],
  [String.raw`text-(?:amber|yellow|orange)-(?:500|600|700|800|900)`, 'text-warning'],
  [String.raw`border-(?:amber|yellow|orange)-(?:100|200|300|400|500|600)`, 'border-warning'],
  [String.raw`bg-(?:blue|sky)-(?:50|100)(?:\/\d+)?`, 'bg-info-soft'],
  [String.raw`bg-(?:blue|sky)-(?:400|500|600|700)`, 'bg-info'],
  [String.raw`text-(?:blue|sky)-(?:500|600|700|800|900)`, 'text-info'],
  [String.raw`border-(?:blue|sky)-(?:100|200|300|400|500)`, 'border-info'],
  // neutrals
  [String.raw`bg-white(?:\/\d+)?`, 'bg-surface'],
  [String.raw`bg-(?:slate|gray|zinc|neutral)-(?:50|100)(?:\/\d+)?`, 'bg-surface-2'],
  [String.raw`bg-(?:slate|gray|zinc|neutral)-(?:200)`, 'bg-line'],
  [String.raw`bg-(?:slate|gray|zinc|neutral)-(?:300|400)`, 'bg-line-strong'],
  [String.raw`bg-(?:slate|gray|zinc|neutral)-(?:500|600|700|800|900)`, 'bg-ink-muted'],
  [String.raw`border-(?:slate|gray|zinc|neutral)-(?:50|100|200)`, 'border-line'],
  [String.raw`border-(?:slate|gray|zinc|neutral)-(?:300|400|500)`, 'border-line-strong'],
  [String.raw`border-app-border`, 'border-line'],
  [String.raw`divide-(?:slate|gray)-(?:100|200|300)`, 'divide-line'],
  [String.raw`text-(?:slate|gray|zinc|neutral)-(?:700|800|900|950)`, 'text-ink'],
  [String.raw`text-(?:slate|gray|zinc|neutral)-(?:500|600)`, 'text-ink-muted'],
  [String.raw`text-(?:slate|gray|zinc|neutral)-(?:300|400)`, 'text-ink-faint'],
  [String.raw`bg-app-head`, 'bg-surface-2'],
  [String.raw`bg-app-bg`, 'bg-canvas'],
  [String.raw`bg-app-panel`, 'bg-surface'],
  [String.raw`bg-brand-light(?:\/\d+)?`, 'bg-brand-soft'],
  [String.raw`bg-brand-mid`, 'bg-brand-soft'],
  // typography / density
  [String.raw`text-\[10px\]`, 'text-[11px]'],
  [String.raw`text-\[11px\]`, 'text-xs'],
  [String.raw`text-\[12px\]`, 'text-[13px]'],
  [String.raw`h-6`, 'h-8'],
  [String.raw`h-7`, 'h-9'],
  [String.raw`rounded-sm`, 'rounded-lg'],
  [String.raw`rounded-md`, 'rounded-lg'],
].map(([a, b]) => typeof a !== 'string' ? [a, b] : [new RegExp('(^|[\\s"\'`{(])' + P + '(' + a + ')(?=$|[\\s"\'`})])', 'g'), null, b]);
// the above builds: group1 boundary, group2 variant prefix, group3 token
const bareRounded = /(^|[\s"'`])rounded(?=$|[\s"'`])/g;

function walk(d, out = []) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p, out); else if (/\.tsx?$/.test(f.name)) out.push(p); } return out; }
const counts = {};
for (const t of targets) {
  for (const f of walk(path.join(root, t))) {
    if (skip(f)) continue;
    let s = fs.readFileSync(f, 'utf8'); const orig = s; let n = 0;
    for (const r of rules) {
      if (r.length === 2) { s = s.replace(r[0], () => { n++; return r[1]; }); continue; }
      s = s.replace(r[0], (m, b, pre) => { n++; return b + pre + r[2]; });
    }
    s = s.replace(bareRounded, (m, b) => { n++; return b + 'rounded-lg'; });
    if (s !== orig) { counts[t] = (counts[t] || 0) + n; if (!dry) fs.writeFileSync(f, s); }
  }
}
console.log(counts);
