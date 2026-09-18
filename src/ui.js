/* أدوات مشتركة للواجهة */
(function (App) {
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function todayISO() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  /* صيغة رقمية تُقرأ من اليمين: يوم/شهر/سنةم — علامة الاتجاه (RLM) بين الأجزاء تمنع المتصفح و Word
     من قلب التاريخ إلى اتجاه اليسار، فيبقى اليوم يميناً و«م» ملاصقاً للسنة */
  function formatDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}‏/${m}‏/${y}م`;
  }

  const isOverdue = (task) => !task.done && task.dueDate && task.dueDate < todayISO();

  const fmt = (n, digits = 0) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: digits });

  function progressBar(pct) {
    const p = Math.round(Math.min(100, Math.max(0, pct)));
    return `<div class="progress-cell"><div class="progress" style="flex:1"><i style="width:${p}%"></i></div><span class="pct">${p}%</span></div>`;
  }

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // احتياطي للمتصفحات التي تمنع الحافظة عند الفتح من ملف محلي
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast("تم نسخ النص");
  }

  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  App.ui = { esc, todayISO, formatDate, isOverdue, fmt, progressBar, toast, copyText, download };
})(window.App = window.App || {});
