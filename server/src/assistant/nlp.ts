const synonyms: Record<string, string> = {
  atleast: "atleast",
  atmost: "atmost",
  delivered: "delivery",
  hot: "top",
  scarce: "low",
  offices: "branch",
  office: "branch",
  crew: "employee",
  earnings: "profit",
  agreements: "contract",
  agreement: "contract",
  modified: "history",
  cogs: "gross profit",
  deliveries: "delivery",
  delivering: "delivery",
  receipts: "receipt",
  received: "receipt",
  sales: "sale",
  sold: "sale",
  sell: "sale",
  selling: "sale",
  purchases: "purchase",
  procurement: "purchase",
  buying: "purchase",
  bought: "purchase",
  buy: "purchase",
  invoices: "invoice",
  bills: "invoice",
  bill: "invoice",
  orders: "order",
  quotations: "quote",
  quotation: "quote",
  quotes: "quote",
  estimates: "quote",
  estimate: "quote",
  inventory: "stock",
  inventories: "stock",
  quantities: "quantity",
  balances: "balance",
  clients: "customer",
  client: "customer",
  customers: "customer",
  buyers: "customer",
  buyer: "customer",
  vendors: "supplier",
  vendor: "supplier",
  suppliers: "supplier",
  employees: "employee",
  staff: "employee",
  team: "employee",
  members: "employee",
  details: "detail",
  profiles: "profile",
  contacts: "contact",
  prices: "price",
  costs: "cost",
  specifications: "specification",
  specs: "specification",
  machines: "machine",
  equipment: "machine",
  locations: "location",
  serials: "serial",
  branches: "branch",
  revenues: "revenue",
  turnover: "revenue",
  totals: "total",
  sums: "total",
  spending: "spending",
  spent: "spending",
  owes: "due",
  owe: "due",
  owing: "due",
  outstanding: "due",
  unpaid: "due",
  arrears: "due",
  receivables: "due",
  receivable: "due",
  payables: "due",
  payable: "due",
  overdue: "due",
  expiring: "expire",
  expires: "expire",
  expiry: "expire",
  expiration: "expire",
  renewals: "renew",
  renewal: "renew",
  ending: "end",
  ends: "end",
  visits: "visit",
  services: "service",
  servicing: "service",
  scheduled: "scheduled",
  upcoming: "upcoming",
  next: "next",
  contracts: "contract",
  amcs: "amc",
  show: "list",
  display: "list",
  get: "list",
  give: "list",
  find: "find",
  listing: "list",
  directory: "list",
  best: "top",
  biggest: "top",
  highest: "top",
  leading: "top",
  rank: "top",
  ranking: "top",
  most: "top",
  waiting: "pending",
  undelivered: "pending delivery",
  backlog: "pending",
  running: "low",
  replenishment: "reorder",
  shortages: "shortage",
  items: "product",
  products: "product",
  models: "product",
  records: "record",
  changes: "change",
  changed: "history",
  edited: "history",
  updated: "history",
  revisions: "history",
  revision: "history",
  previous: "history",
  yesterday: "yesterday",
};
const typos: Record<string, string> = {
  stok: "stock",
  acm: "amc",
  stk: "stock",
  qty: "quantity",
  inv: "invoice",
  grns: "grn",
  reciepts: "receipt",
  recipts: "receipt",
  quots: "quote",
  dues: "due",
};
const phrases: [RegExp, string][] = [
  [
    /\b(?:which customer|who) (?:bought|purchased|owns|has) (?:this |the )?(?:machine |serial(?: number)? )?/g,
    "machine serial trace ",
  ],
  [/\bat least\b/g, "atleast"],
  [/\bat most\b/g, "atmost"],
  [/\bnot shipped\b/g, "pending"],
  [/\bwhat still needs delivering\b/g, "pending delivery"],
  [/\bwhich customer has (?:this |the )?machine\b/g, "machine serial trace"],
  [/\bfind (?:a |an )?(?:employee|staff member)\b/g, "employee detail"],
  [/\blook up (?:a |an )?employee\b/g, "employee detail"],
  [/\b(?:best sellers|bestsellers)\b/g, "top product"],
  [/\b(?:on hand|onhand)\b/g, "onhand"],
  [/\b(?:who owes|who owe)\b/g, "customer due"],
  [/\b(?:cost of goods|cost of sales)\b/g, "gross cost"],
  [/\bgp\b/g, "gross profit"],
  [/\bpo\b/g, "purchase order"],
  [/\bso\b/g, "sale order"],
  [/\bar\b/g, "customer due"],
  [/\bap\b/g, "supplier due"],
  [/\bhow much did we make\b/g, "profit"],
  [/\bnet profit\b/g, "unsupportednetprofit"],
  [/\b(?:new values|old values)\b/g, "change history"],
  [/\b(?:how many|number of)\b/g, "count"],
  [/\b(?:more than|greater than)\b/g, "above"],
  [/\b(?:less than|fewer than)\b/g, "below"],
];
const stop = new Set(
  "a an the is are was were be been being do does did can could would should please me us our we i my their its it this that those these to of for from in on at by with as and or about what which who how much have has had all any still needs need want tell give see show find look up only same also now instead than".split(
    " ",
  ),
);
const units: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
export function fold(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[??]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
export function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}
function numbers(text: string) {
  return text.replace(
    /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)(?:[ -]+(?:and[ -]+)?(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million))*\b/g,
    (match) => {
      let total = 0,
        n = 0;
      for (const word of match.split(/[ -]+/)) {
        if (word === "and") continue;
        if (word === "hundred") n = (n || 1) * 100;
        else if (word === "thousand" || word === "million") {
          total += (n || 1) * (word === "thousand" ? 1000 : 1000000);
          n = 0;
        } else n += units[word] ?? 0;
      }
      return String(total + n);
    },
  );
}
export function normalise(text: string, vocabulary: Iterable<string> = []) {
  let value = numbers(fold(text));
  for (const [pattern, replacement] of phrases)
    value = value.replace(pattern, replacement);
  const vocab = new Set([
    ..."delete remove create insert update edit change send email approve reject cancel post pay transfer dispatch add modify execute drop truncate alter grant revoke generate raise prepare issue build place book".split(
      " ",
    ),
    ...Object.keys(synonyms),
    ...Object.values(synonyms),
    ...Object.keys(typos),
    ...vocabulary,
  ]);
  return value.replace(/\b[a-z]+\b/g, (word) => {
    if (typos[word]) return typos[word];
    if (synonyms[word]) return synonyms[word];
    if (vocab.has(word) || stop.has(word) || word.length < 4) return word;
    let best = Infinity,
      hits: string[] = [];
    for (const candidate of vocab) {
      if (Math.abs(candidate.length - word.length) > 1) continue;
      const score = distance(word, candidate);
      if (score < best) {
        best = score;
        hits = [candidate];
      } else if (score === best) hits.push(candidate);
    }
    const canonical = [...new Set(hits.map((w) => synonyms[w] || w))];
    return best <= (word.length >= 8 ? 2 : 1) && canonical.length === 1
      ? canonical[0]
      : word;
  });
}
export function tokens(text: string) {
  return fold(text)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !stop.has(w) && !/^\d+$/.test(w));
}
export function actionRequest(text: string) {
  const value = fold(text);
  if (
    /(?:^|\bplease\s+)(?:make|generate|raise|prepare|issue|build|place|book)\b/.test(
      value,
    ) ||
    /\b(?:make|generate|raise|prepare|issue|build|place|book)\s+(?:(?:me|us)\s+)?(?:(?:a|an|new|the)\s+)?(?:sale|sales|purchase|customer|supplier|employee|invoice|order|quote|quotation|payment|receipt|record|amc)\b/.test(
      value,
    )
  )
    return true;
  if (
    /\b(?:who|when)\s+(?:last\s+)?(?:created|changed|edited|updated|modified|deleted|approved|posted|sent)\b/.test(
      value,
    ) ||
    /\b(?:edit|change|revision) (?:history|log)\b/.test(value)
  )
    return false;
  return /\b(?:delete|remove|create|insert|update|edit|change|send|email|whatsapp|approve|reject|cancel|post|pay|transfer|dispatch|add|modify|execute|drop|truncate|alter|grant|revoke)\b/.test(
    value,
  );
}
export const synonymVocabulary = Object.keys(synonyms).concat(
  Object.values(synonyms),
);
