/* يشغّل اختبارات الإضافة الشاملة في متصفح حقيقي (Edge/Chrome Chromium) ضد نظام مركز وهمي.

   الاستعمال (من مجلد Tamkeen):
     node tools/e2e/run.js

   يبني نسخة اختبار من الإضافة، ويشغّل النظام الوهمي (المنفذ 4197)، ثم يشغّل كل اختبار في متصفح جديد.
   المتصفح: متغير BROWSER أو مسار Edge الافتراضي في ويندوز.
   ملاحظة: يحتاج المنفذين 4180 و4196 و9334 فارغة (أوقف خادم المعاينة المحلي قبل التشغيل). */
const { spawn, spawnSync, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const EXT = path.join(os.tmpdir(), "tamkeen-ext-test");
const CANDIDATES = [
  process.env.BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const BROWSER = CANDIDATES.find((p) => fs.existsSync(p));
if (!BROWSER) { console.error("لم أجد متصفحاً. اضبط BROWSER على مسار msedge.exe أو chromium."); process.exit(2); }

function killBrowsers() {
  if (process.platform !== "win32") return;
  try {
    execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq \'msedge.exe\' -and $_.CommandLine -match \'remote-debugging-port=9334|kx-edge-\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"', { stdio: "ignore" });
  } catch (e) { /* لا شيء لإيقافه */ }
}

console.log("بناء نسخة الاختبار من الإضافة…");
const b = spawnSync(process.execPath, [path.join(ROOT, "tools", "build-extension.js"), "--test", EXT], { stdio: "inherit" });
if (b.status !== 0) process.exit(1);

const mock = spawn(process.execPath, [path.join(__dirname, "mockksach.js")], { stdio: "ignore" });
const tests = ["ui.js", "full.js", "background-tab.js", "stop-and-partial.js"];
let failed = 0;
setTimeout(() => {
  for (const t of tests) {
    killBrowsers();
    console.log("\n=== " + t + " ===");
    const r = spawnSync(process.execPath, [path.join(__dirname, t)], { env: Object.assign({}, process.env, { BROWSER, KX_EXT: EXT }), encoding: "utf8", timeout: 300000 });
    const out = (r.stdout || "") + (r.stderr || "");
    console.log(out.split("\n").filter((l) => /^[✓✗]|إخفاق|خطأ/.test(l)).join("\n"));
    const m = out.match(/(\d+) إخفاق من (\d+)/);
    if (!m || Number(m[1]) > 0) failed++;
  }
  killBrowsers();
  try { mock.kill(); } catch (e) { /* */ }
  console.log(failed ? "\nفشل " + failed + " اختبار/اختبارات" : "\nنجحت كل الاختبارات");
  process.exit(failed ? 1 : 0);
}, 1500);
