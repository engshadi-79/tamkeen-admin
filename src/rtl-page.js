/* صفحة «تصحيح اتجاه ملف Word»: ملف أو عدة ملفات ← نسخ مصحّحة، مع أرشفة اختيارية على Drive */
(function (App) {
  const { ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;
  let results = []; // { name, blob, stats, error, driveLink }

  const extOf = (name) => (/\.pptx$/i.test(name) ? "pptx" : "docx");
  const fixedName = (name) => name.replace(/\.(docx|pptx)$/i, "") + " - مصحح." + extOf(name);

  function render() {
    const list = $("rtl-results");
    if (!results.length) { list.innerHTML = ""; $("rtl-actions").hidden = true; return; }
    $("rtl-actions").hidden = false;
    $("rtl-download-all").hidden = results.filter((r) => r.blob).length < 2;
    list.innerHTML = results.map((r, i) => r.error
      ? `<li class="rtl-item err"><b>${esc(r.name)}</b><span>${esc(r.error)}</span></li>`
      : `<li class="rtl-item" data-i="${i}">
          <b>${esc(fixedName(r.name))}</b>
          <span class="conv-hint">${r.stats.slides ? `${ui.fmt(r.stats.slides)} شريحة، ` : ""}${ui.fmt(r.stats.paragraphs)} فقرة، ${ui.fmt(r.stats.runs)} ${r.stats.slides ? "فقرة ضُبط اتجاهها" : "نص عربي"}، ${ui.fmt(r.stats.tables)} جدول${r.stats.align ? `، ${ui.fmt(r.stats.align)} محاذاة` : ""}${r.stats.parts ? "" : " — الملف سليم أصلاً، لم يلزم تعديل"}</span>
          <span class="rtl-btns">
            <button class="btn small" data-dl>تنزيل</button>
            ${r.driveLink ? `<a class="conv-link" href="${esc(r.driveLink)}" target="_blank" rel="noopener"><span class="material-symbols-outlined btn-ico">cloud</span>فتح في Drive</a>` : `<button class="btn secondary small" data-drive><span class="material-symbols-outlined btn-ico">cloud</span>أرشفة في Drive</button>`}
          </span>
        </li>`).join("");
  }

  async function handleFiles(files) {
    const list = [...files].filter((f) => /\.(docx|pptx)$/i.test(f.name));
    if (!list.length) { ui.toast("اختر ملفات Word (.docx) أو PowerPoint (.pptx)"); return; }
    if (typeof JSZip === "undefined") { ui.toast("تعذّر تحميل مكتبة JSZip"); return; }
    $("rtl-busy").hidden = false;
    for (const f of list) {
      try {
        const { blob, stats } = await App.rtlFixer.fixFile(await f.arrayBuffer(), f.name);
        results.unshift({ name: f.name, blob, stats });
      } catch (e) {
        console.error(e);
        const ppt = /\.pptx$/i.test(f.name);
        results.unshift({ name: f.name, error: e.message && /[؀-ۿ]/.test(e.message) ? e.message
          : `تعذّر قراءة الملف؛ تأكد أنه ملف ${ppt ? "PowerPoint" : "Word"} سليم.` });
      }
    }
    $("rtl-busy").hidden = true;
    $("rtl-input").value = "";
    render();
    ui.toast(list.length === 1 ? "تم تصحيح الملف" : `تم تصحيح ${list.length} ملفات`);
  }

  async function archive(r) {
    if (!(await App.driveUI.ensureConnected())) return;
    try {
      const res = await App.drive.upload(r.blob, fixedName(r.name), App.drive.datePath("ملفات مصححة الاتجاه"));
      r.driveLink = res.link;
      render();
      ui.toast("تمت الأرشفة في Google Drive");
    } catch (e) {
      ui.toast(e.message === "NOT_CONNECTED" ? "انتهت جلسة Drive؛ اضغط الأرشفة مرة أخرى" : e.message);
    }
  }

  async function downloadAll() {
    const zip = new JSZip();
    results.filter((r) => r.blob).forEach((r) => zip.file(fixedName(r.name), r.blob));
    ui.download(`ملفات مصححة - ${ui.todayISO()}.zip`, await zip.generateAsync({ type: "blob" }));
  }

  function init() {
    $("rtl-input").addEventListener("change", (e) => handleFiles(e.target.files));
    const drop = $("rtl-drop");
    ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));
    $("rtl-results").addEventListener("click", (e) => {
      const li = e.target.closest("[data-i]");
      if (!li) return;
      const r = results[Number(li.dataset.i)];
      if (e.target.closest("[data-dl]")) ui.download(fixedName(r.name), r.blob);
      if (e.target.closest("[data-drive]")) archive(r);
    });
    $("rtl-download-all").addEventListener("click", downloadAll);
    $("rtl-clear").addEventListener("click", () => { results = []; render(); });
  }

  App.rtlPage = { init, render };
})(window.App = window.App || {});
