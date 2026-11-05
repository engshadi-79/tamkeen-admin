/* يبني إضافة وكيل تمكين.

   agent.js يُولَّد من tools/ksach-runner.js نفسه، فلا يوجد كودان يتباعدان:
   الوكيل الذي تُلصقه في Console هو نفسه الذي تشغّله الإضافة.

   الاستعمال:
     node tools/build-extension.js                 يولّد extension/agent.js ويصنع extension/tamkeen-center-agent.zip
     node tools/build-extension.js --test <مجلد>   نسخة اختبار تعمل على النظام الوهمي (localhost:4197) */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "extension");
const FILES = ["manifest.json", "background.js", "bridge.js", "popup.html", "popup.js", "agent-boot.js", "agent.js", "icon.png", "اقرأني.txt"];

const runner = fs.readFileSync(path.join(ROOT, "tools", "ksach-runner.js"), "utf8");
const open = "(async () => {";
const close = "})();";
if (runner.split(open).length !== 2) throw new Error("ksach-runner.js: بداية الوكيل غير فريدة");
if (!runner.trimEnd().endsWith(close)) throw new Error("ksach-runner.js: نهاية الوكيل غير متوقعة");

// الوكيل كما هو، لكن دالة تُستدعى حين تصل الأوامر بدل أن تعمل فور التحميل
let agent = runner.replace(open, "window.__kxStart = async () => {");
agent = agent.slice(0, agent.lastIndexOf(close)) + "};\n";
agent = "/* مُولَّد من tools/ksach-runner.js — لا تعدّله هنا. */\n" + agent;

const args = process.argv.slice(2);
const testIdx = args.indexOf("--test");

if (testIdx >= 0) {
  const out = path.resolve(args[testIdx + 1]);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  FILES.filter((f) => f !== "agent.js").forEach((f) => fs.copyFileSync(path.join(SRC, f), path.join(out, f)));
  const T = "http://localhost:4197/";                       // نظام المركز الوهمي
  const APPS = ["http://localhost:4196/", "http://localhost:4180/"];   // صفحة تمكين الاختبارية والحقيقية محلياً
  const m = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
  m.host_permissions = [T + "*"];
  m.content_scripts[0].matches = APPS.map((a) => a + "*");
  m.content_scripts[1].matches = [T + "*"];
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(m, null, 2));
  const bg = fs.readFileSync(path.join(out, "background.js"), "utf8")
    .replace('const KSACH = "https://tamkeen.ksach.org/";', 'const KSACH = "' + T + '";')
    .replace('const APPS = ["https://tamkeen-admin.vercel.app/"];', "const APPS = " + JSON.stringify(APPS) + ";");
  if (!bg.includes(T) || !bg.includes(APPS[0])) throw new Error("لم تُستبدل ثوابت الاختبار في background.js");
  fs.writeFileSync(path.join(out, "background.js"), bg);
  // الاختبار على localhost: يتجاوز حارس اسم النطاق في الوكيل
  fs.writeFileSync(path.join(out, "agent.js"), "window.__KX_TEST = true;\n" + agent);
  console.log("نسخة اختبار في", out);
} else {
  fs.writeFileSync(path.join(SRC, "agent.js"), agent);
  const JSZip = require(path.join(ROOT, "vendor", "jszip.min.js"));
  const zip = new JSZip();
  FILES.forEach((f) => zip.file("tamkeen-center-agent/" + f, fs.readFileSync(path.join(SRC, f))));
  zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }).then((buf) => {
    fs.writeFileSync(path.join(SRC, "tamkeen-center-agent.zip"), buf);
    console.log("agent.js +", "tamkeen-center-agent.zip", buf.length, "بايت");
  });
}
