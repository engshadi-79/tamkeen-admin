/* قاعدة بيانات وهمية في الذاكرة تحاكي الجزء المستعمل من supabase-js،
   لاختبار منطق الدمج في الدالة الطرفية قبل نشرها. */

const PK = {
  app_users: ["username"], sessions: ["token"], resets: ["username"],
  records: ["col", "id"], deletions: ["col", "id"], counters: ["head"],
  kv: ["key"], files: ["id"], events: ["id"],
};

/* الأعمدة الإلزامية بلا قيمة افتراضية في schema.sql */
const NOT_NULL = {
  app_users: ["username", "name", "salt", "hash"],
  sessions: ["token", "username", "expires_at"],
  resets: ["username", "code", "expires_at"],
  records: ["col", "id", "data"],
  deletions: ["col", "id", "at"],
  counters: ["head"],
  kv: ["key", "value"],
  files: ["id", "name"],
};

export function makeDb() {
  const tables = {};
  const buckets = {};
  for (const t of Object.keys(PK)) tables[t] = [];
  let eventId = 1;

  const keyOf = (table, row, cols) => (cols || PK[table]).map((c) => String(row[c])).join("\u0000");

  class Query {
    constructor(table) { this.table = table; this.filters = []; this.op = null; this._order = null; this._limit = null; this._range = null; this._single = false; this._count = null; this._head = false; }
    select(_cols, opts) { if (!this.op) this.op = "select"; if (opts && opts.count) { this._count = opts.count; this._head = !!opts.head; } return this; }
    eq(c, v) { this.filters.push((r) => String(r[c]) === String(v)); return this; }
    in(c, list) { const set = new Set(list.map(String)); this.filters.push((r) => set.has(String(r[c]))); return this; }
    gte(c, v) { this.filters.push((r) => String(r[c]) >= String(v)); return this; }
    lt(c, v) { this.filters.push((r) => String(r[c]) < String(v)); return this; }
    ilike(c, pat) { const re = new RegExp("^" + pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i"); this.filters.push((r) => re.test(String(r[c] ?? ""))); return this; }
    order(c, opts) { this._order = { c, asc: !opts || opts.ascending !== false }; return this; }
    limit(n) { this._limit = n; return this; }
    range(a, b) { this._range = [a, b]; return this; }
    maybeSingle() { this._single = true; return this; }
    insert(rows) { this.op = "insert"; this.rows = [].concat(rows); return this; }
    upsert(rows, opts) { this.op = "upsert"; this.rows = [].concat(rows); this.onConflict = opts && opts.onConflict ? opts.onConflict.split(",") : null; return this; }
    update(patch) { this.op = "update"; this.patch = patch; return this; }
    delete() { this.op = "delete"; return this; }

    run() {
      const rows = tables[this.table];
      const match = (r) => this.filters.every((f) => f(r));
      if (this.op === "insert" || this.op === "upsert") {
        const cols = this.onConflict;
        // كما يفعل Postgres: الأعمدة الإلزامية تُفحص في الصف المقترح قبل البحث عن تعارض،
        // فصفّ ناقص يفشل حتى لو كان تحديثاً لصفّ موجود
        for (const row of this.rows) {
          const missing = (NOT_NULL[this.table] || []).find((c) => row[c] === undefined || row[c] === null);
          if (missing) return { data: null, error: { message: `null value in column "${missing}" of relation "${this.table}" violates not-null constraint` } };
        }
        for (const row of this.rows) {
          if (this.table === "events" && row.id === undefined) row.id = eventId++;
          if (this.table === "events" && !row.at) row.at = new Date().toISOString();
          const k = keyOf(this.table, row, cols);
          const at = rows.findIndex((r) => keyOf(this.table, r, cols) === k);
          if (at >= 0) {
            if (this.op === "insert") return { data: null, error: { message: "duplicate key" } };
            rows[at] = { ...rows[at], ...row };
          } else rows.push({ ...row });
        }
        return { data: this.rows, error: null };
      }
      if (this.op === "update") {
        rows.forEach((r, i) => { if (match(r)) rows[i] = { ...r, ...this.patch }; });
        return { data: null, error: null };
      }
      if (this.op === "delete") {
        tables[this.table] = rows.filter((r) => !match(r));
        return { data: null, error: null };
      }
      let out = rows.filter(match);
      if (this._order) out.sort((a, b) => (String(a[this._order.c]) < String(b[this._order.c]) ? -1 : 1) * (this._order.asc ? 1 : -1));
      if (this._range) out = out.slice(this._range[0], this._range[1] + 1);
      if (this._limit != null) out = out.slice(0, this._limit);
      const count = this._count ? rows.filter(match).length : null;
      if (this._head) return { data: null, count, error: null };
      if (this._single) return { data: out[0] ? { ...out[0] } : null, count, error: null };
      return { data: out.map((r) => ({ ...r })), count, error: null };
    }
    then(res, rej) { try { return Promise.resolve(this.run()).then(res, rej); } catch (e) { return Promise.reject(e).catch(rej); } }
  }

  const storage = {
    from(name) {
      buckets[name] = buckets[name] || new Map();
      const b = buckets[name];
      return {
        async upload(path, body, opts) {
          // قاعدة Supabase Storage نفسها لأسماء الملفات: حروف S3 الآمنة فقط، فلا عربية
          if (!(path.length > 0 && /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/.test(path))) {
            return { data: null, error: { message: `Invalid key: ${path}` } };
          }
          if (b.has(path) && !(opts && opts.upsert)) return { data: null, error: { message: "exists" } };
          b.set(path, { body, created_at: new Date().toISOString() });
          return { data: { path }, error: null };
        },
        async download(path) {
          if (!b.has(path)) return { data: null, error: { message: "not found" } };
          const v = b.get(path).body;
          if (v instanceof Blob) return { data: v, error: null };
          const bytes = v instanceof Uint8Array ? v : new TextEncoder().encode(String(v));
          return { data: new Blob([bytes], { type: "application/octet-stream" }), error: null };
        },
        async list(_p, opts) {
          let names = [...b.entries()].map(([name, v]) => ({ name, created_at: v.created_at }));
          if (opts && opts.sortBy) names.sort((x, y) => (x.name < y.name ? -1 : 1) * (opts.sortBy.order === "desc" ? -1 : 1));
          return { data: names.slice(0, (opts && opts.limit) || 100), error: null };
        },
        async remove(list) { list.forEach((n) => b.delete(n)); return { data: null, error: null }; },
        async createSignedUrl(path) { return { data: { signedUrl: `https://fake/${name}/${path}` }, error: null }; },
      };
    },
  };

  return {
    _tables: tables,
    from: (t) => new Query(t),
    storage,
    async rpc(fn, args) {
      if (fn !== "reserve_numbers") return { data: null, error: { message: "unknown rpc" } };
      const head = args.p_head;
      let row = tables.counters.find((c) => c.head === head);
      if (!row) { row = { head, value: 0 }; tables.counters.push(row); }
      let recMax = 0;
      for (const r of tables.records) {
        if (r.col !== "registry") continue;
        const n = String(r.data?.number || "");
        if (n.slice(0, head.length) !== head) continue;
        const m = /^\d{1,9}/.exec(n.slice(head.length));
        if (m) recMax = Math.max(recMax, Number(m[0]));
      }
      const max = Math.max(row.value, recMax);
      row.value = max + args.p_count;
      return { data: row.value, error: null };
    },
  };
}

export const createClient = () => globalThis.__fakeDb;
