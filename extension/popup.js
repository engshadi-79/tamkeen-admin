/* نافذة الإضافة: اختيار ملف الأوامر وإرساله للخلفية. لا يمرّ شيء بأي خادم. */
(() => {
  const $ = (id) => document.getElementById(id);
  let pack = null;

  const TYPE = { register: "تسجيل", lookup: "استعلام", list: "استخراج قائمة" };
  const summary = (p) => p.commands.map((c) => {
    const n = c.type === "register" ? (c.rows || []).length + " طالباً" : c.type === "lookup" ? (c.items || []).length + " عنصراً" : "";
    return (TYPE[c.type] || c.type) + (n ? " (" + n + ")" : "");
  }).join(" · ");

  $("f").addEventListener("change", async (e) => {
    pack = null;
    $("go").disabled = true;
    $("msg").textContent = "";
    const file = e.target.files[0];
    if (!file) { $("info").textContent = "لم يُختر ملف."; return; }
    try {
      const j = JSON.parse(await file.text());
      if (!j || !Array.isArray(j.commands) || !j.commands.length) throw new Error("ليس ملف أوامر");
      pack = j;
      $("info").textContent = summary(j);
      $("go").disabled = false;
    } catch (err) {
      $("info").textContent = "الملف غير صالح — اختر ksach-commands.json من تمكين.";
    }
  });

  $("go").addEventListener("click", async () => {
    if (!pack) return;
    $("go").disabled = true;
    try {
      const r = await chrome.runtime.sendMessage({ type: "run", pack });
      if (!r || !r.ok) throw new Error((r && r.error) || "تعذّر البدء");
      $("msg").className = "ok";
      $("msg").textContent = r.how === "opened"
        ? "فُتح نظام المركز. سجّل دخولك إن طُلب، وستظهر لوحة المعاينة."
        : "تابع لوحة المعاينة في تبويب نظام المركز.";
      setTimeout(() => window.close(), 1800);
    } catch (err) {
      $("msg").className = "err";
      $("msg").textContent = err.message;
      $("go").disabled = false;
    }
  });
})();
