/* اختبار رفع المراقب إلى «ملفات الزملاء» بلا Google: خادم محلي يحاكي dropCats وdropInit وجلسة الرفع.
   التشغيل: node tools/test-watcher-colleagues.mjs */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "watcher", "watch-folder.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tamkeen-wc-"));
const watch = path.join(tmp, "watch");
fs.mkdirSync(path.join(watch, "خطابات"), { recursive: true });
fs.copyFileSync(SRC, path.join(tmp, "watch-folder.mjs"));

const inits = [];
const puts = {};
let port = 0;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    if (req.method === "PUT") {
      const id = req.url.slice(1);
      (puts[id] = puts[id] || []).push({ range: req.headers["content-range"], bytes: Buffer.concat(chunks).length });
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(req.headers["content-range"] || "");
      res.statusCode = m && Number(m[2]) + 1 === Number(m[3]) ? 200 : 308;
      return res.end("{}");
    }
    const b = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    res.setHeader("Content-Type", "application/json");
    if (b.action === "dropCats") return res.end(JSON.stringify({ cats: ["تقارير", "كتب ومراجع", "نماذج", "خطابات", "صور", "أخرى"] }));
    if (b.action === "dropInit") {
      inits.push(b);
      return res.end(JSON.stringify({ ok: true, url: `http://127.0.0.1:${port}/s${inits.length}`, chunk: 8388608 }));
    }
    res.end(JSON.stringify({ error: "إجراء غير معروف" }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
port = server.address().port;

fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({
  folders: [watch], target: "drive", subfolders: true, stableSeconds: 0, intervalSeconds: 60,
  drive: { url: `http://127.0.0.1:${port}/`, key: "x" },
  colleagues: { enabled: true, by: "د.يوسف", only: true },
}));

/* غير متزامن: الخادم الوهمي في هذه العملية نفسها، فلا يجوز حجز حلقة الأحداث */
const run = () => new Promise((resolve) => {
  const c = spawn(process.execPath, [path.join(tmp, "watch-folder.mjs"), "--once"], { cwd: tmp });
  let out = "";
  c.stdout.on("data", (d) => { out += d; }); c.stderr.on("data", (d) => { out += d; });
  const t = setTimeout(() => { c.kill(); out += " [انتهت المهلة]"; }, 60000);
  c.on("close", () => { clearTimeout(t); resolve({ stdout: out, stderr: "" }); });
});
let fails = 0;
const ok = (name, cond, extra) => { console.log((cond ? "✓ " : "✗ ") + name + (cond ? "" : " — " + JSON.stringify(extra))); if (!cond) fails++; };

// ملفات موجودة قبل التفعيل: لا تُرفع
fs.writeFileSync(path.join(watch, "قديم.pdf"), "old");
await run();
ok("ما كان موجوداً قبل التفعيل لا يُرفع", inits.length === 0, inits.length);

// ملفات تُضاف بعد التفعيل
fs.writeFileSync(path.join(watch, "تقرير الشهر.pdf"), "report");
fs.writeFileSync(path.join(watch, "photo.JPG"), "img");
fs.writeFileSync(path.join(watch, "خطابات", "ملف عادي.docx"), "letter");
fs.writeFileSync(path.join(watch, "نموذج استئذان.docx"), "form");
fs.writeFileSync(path.join(watch, "شيء.bin"), "other");
fs.writeFileSync(path.join(watch, "ضخم.zip"), Buffer.alloc(20 * 1024 * 1024, 1));
fs.writeFileSync(path.join(watch, "فارغ.txt"), "");
const old = new Date("2025-03-05T10:00:00Z");
fs.utimesSync(path.join(watch, "تقرير الشهر.pdf"), old, old);
await new Promise((r) => setTimeout(r, 50));
const r2 = await run();
const by = (n) => inits.find((i) => i.name === n);
ok("تقرير ← تقارير", by("تقرير الشهر.pdf") && by("تقرير الشهر.pdf").cat === "تقارير", inits.map((i) => i.name + ":" + i.cat));
ok("صورة ← صور", by("photo.JPG") && by("photo.JPG").cat === "صور");
ok("مجلد فرعي باسم التصنيف ← خطابات", by("ملف عادي.docx") && by("ملف عادي.docx").cat === "خطابات");
ok("نموذج ← نماذج", by("نموذج استئذان.docx") && by("نموذج استئذان.docx").cat === "نماذج");
ok("غير معروف ← أخرى", by("شيء.bin") && by("شيء.bin").cat === "أخرى");
ok("الشخص د.يوسف", inits.every((i) => i.by === "د.يوسف"));
ok("الملف الفارغ لا يُرفع", !by("فارغ.txt"));
ok("القديم لا يُرفع", !by("قديم.pdf"));
ok("تاريخ الإنشاء الأصلي يُرسل", by("تقرير الشهر.pdf") && !Number.isNaN(Date.parse(by("تقرير الشهر.pdf").createdTime)));
const big = inits.findIndex((i) => i.name === "ضخم.zip") + 1;
ok("الملف الكبير على 3 دفعات", puts["s" + big] && puts["s" + big].length === 3 && puts["s" + big].reduce((a, b) => a + b.bytes, 0) === 20 * 1024 * 1024, puts["s" + big]);

// مجلد ثانٍ يُضاف لاحقاً: ما فيه يُختم، وما يُضاف بعده يُرفع، ومجلدات المخرجات تُتجاهل
const watch2 = path.join(tmp, "watch2");
fs.mkdirSync(path.join(watch2, "ملفات الزملاء", "تقارير"), { recursive: true });
fs.writeFileSync(path.join(watch2, "قديم2.pdf"), "old2");
fs.writeFileSync(path.join(watch2, "ملفات الزملاء", "تقارير", "منزّل من الموقع.pdf"), "downloaded");
fs.writeFileSync(path.join(watch2, "فهرس-النسخة-الاحتياطية.json"), "{}");
const cfg = JSON.parse(fs.readFileSync(path.join(tmp, "config.json"), "utf8"));
cfg.folders.push(watch2); cfg.ignore = ["ملفات الزملاء", "فهرس-النسخة-الاحتياطية.json"];
fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify(cfg));
const before2 = inits.length;
await run();
ok("المجلد الثاني: ما فيه يُختم ولا يُرفع", inits.length === before2, inits.slice(before2).map((i) => i.name));
fs.writeFileSync(path.join(watch2, "جديد2.pdf"), "new2");
fs.writeFileSync(path.join(watch2, "ملفات الزملاء", "تقارير", "منزّل آخر.pdf"), "downloaded2");
await run();
const got2 = inits.slice(before2).map((i) => i.name);
ok("المجلد الثاني: الجديد يُرفع", got2.includes("جديد2.pdf"), got2);
ok("مجلد المخرجات وفهرس النسخة يُتجاهلان", !got2.some((n) => /منزّل|فهرس/.test(n)), got2);

// تصنيف افتراضي من الإعدادات للملفات غير المعروفة
const cfg2 = JSON.parse(fs.readFileSync(path.join(tmp, "config.json"), "utf8"));
cfg2.colleagues.defaultCat = "تقارير";
fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify(cfg2));
fs.writeFileSync(path.join(watch, "ملف مجهول.bin"), "x");
await run();
ok("colleagues.defaultCat يحدد تصنيف غير المعروف", by("ملف مجهول.bin") && by("ملف مجهول.bin").cat === "تقارير", by("ملف مجهول.bin"));

// الجولة التالية لا تكرر شيئاً
const n = inits.length;
await run();
ok("الجولة التالية لا تكرر الرفع", inits.length === n, inits.length - n);

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} إخفاق` : "نجحت كل الاختبارات");
if (fails) console.log(r2.stdout + r2.stderr);
process.exit(fails ? 1 : 0);
