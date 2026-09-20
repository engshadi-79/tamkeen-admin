/* مساعد الصياغة: زر بجانب أي مربع نص يعيد صياغة ما كتبه المستخدم بأسلوب رسمي،
   مع إمكانية التراجع والعودة إلى نصه كما كتبه. لا يضيف معلومات من عنده. */
(function (App) {
  const { ui } = App;

  const SYSTEM = "أنت محرر إداري عربي. أعد صياغة النص بلغة عربية فصيحة رسمية مناسبة للمراسلات الحكومية،"
    + " مع الحفاظ على المعنى والأسماء والأرقام والتواريخ كما هي، بلا إضافة معلومات جديدة ولا حذف بنود،"
    + " وبلا مقدمات ولا تعليقات ولا عناوين، وأعد النص فقط.";

  /* يحوّل نص المستخدم إلى صياغة رسمية داخل نفس المربع، ويحفظ الأصل للتراجع */
  async function polish(el, context, btn) {
    const original = el.value.trim();
    if (!original) { ui.toast("اكتب النص أولاً ثم اضغط الصياغة"); el.focus(); return; }
    if (!App.ai.hasKey()) { ui.toast("أضف مفتاح الذكاء الاصطناعي من صفحة المراسلات ← إعدادات"); return; }

    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "…جارٍ الصياغة";
    el.dataset.aiOriginal = original;
    el.value = "";
    try {
      const multi = original.includes("\n");
      await App.ai.generate({
        request: `${SYSTEM}\n\nالسياق: ${context || "مستند إداري"}.`
          + (multi ? " النص بنود متعددة: اجعل كل بند في سطر مستقل وبالعدد نفسه." : " النص فقرة واحدة: أعده فقرة واحدة."),
        context: original,
        onText: (t) => { el.value += t; el.dispatchEvent(new Event("input", { bubbles: true })); },
      });
      if (!el.value.trim()) throw new Error("لم يصل رد من الخدمة");
      el.value = el.value.trim();
      el.dispatchEvent(new Event("input", { bubbles: true }));
      showUndo(el, btn);
      ui.toast("تمت الصياغة — يمكنك التراجع أو التعديل");
    } catch (e) {
      el.value = original;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      ui.toast(e.message === "NO_KEY" ? "أضف مفتاح الذكاء الاصطناعي أولاً" : e.message);
    }
    btn.disabled = false;
    btn.textContent = label;
  }

  function showUndo(el, btn) {
    let undo = btn.parentElement.querySelector("[data-ai-undo]");
    if (!undo) {
      undo = document.createElement("button");
      undo.type = "button";
      undo.className = "ai-chip undo";
      undo.dataset.aiUndo = "1";
      undo.textContent = "↩ نصي الأصلي";
      btn.after(undo);
      undo.addEventListener("click", () => {
        el.value = el.dataset.aiOriginal || "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        undo.remove();
        ui.toast("أُعيد نصك كما كتبته");
      });
    }
  }

  /* يضيف الزر فوق كل مربع يحمل data-ai-polish ويعمل على أي حقل يُنشأ لاحقاً */
  function attach(root) {
    if (App.profile && App.profile.can && !App.profile.can("ai")) return;
    (root || document).querySelectorAll("[data-ai-polish]:not([data-ai-ready])").forEach((el) => {
      el.dataset.aiReady = "1";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ai-chip";
      btn.textContent = "✨ صياغة رسمية";
      btn.title = "إعادة صياغة ما كتبته بأسلوب رسمي، مع إمكانية التراجع";
      const holder = document.createElement("span");
      holder.className = "ai-chip-row";
      holder.append(btn);
      const label = el.closest("label");
      const target = label ? label.querySelector("span") : null;
      if (target) target.append(holder); else el.before(holder);
      btn.addEventListener("click", () => polish(el, el.dataset.aiPolish, btn));
    });
  }

  App.aiAssist = { attach, polish };
})(window.App = window.App || {});
