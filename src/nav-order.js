/* ترتيب القائمة الجانبية حسب رغبة المستخدم: زر «ترتيب القائمة» يُظهر أسهماً بجانب كل صفحة،
   تنقلها لأعلى أو لأسفل، وتعبر بها إلى القسم المجاور عند بلوغ طرف القسم.
   الترتيب يُحفظ في هذا المتصفح فقط، و«الترتيب الأصلي» يعيده كما كان. */
(function (App) {
  const KEY = "tamkeen-admin:nav-order-v2";   // v2: القائمة الجديدة حسب العمل (الترتيب القديم لا يُطبَّق عليها)
  let original = null;

  const groups = () => [...document.querySelectorAll("#primary-nav > .nav-group")];
  const listOf = (g) => g.querySelector(":scope > ul");
  const viewOf = (li) => { const b = li.querySelector("button[data-view]"); return b ? b.dataset.view : ""; };
  const snapshot = () => { const o = {}; groups().forEach((g) => { o[g.dataset.group] = [...listOf(g).children].map(viewOf).filter(Boolean); }); return o; };
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(snapshot())); } catch (e) { /* ممتلئ */ } };

  /* يطبّق ترتيباً: الصفحات المذكورة تُنقل إلى أقسامها بترتيبها، وما لم يُذكر (صفحة جديدة) يبقى في مكانه */
  function apply(order) {
    if (!order) return;
    groups().forEach((g) => {
      (order[g.dataset.group] || []).forEach((view) => {
        const b = document.querySelector(`#primary-nav button[data-view="${view}"]`);
        if (b) listOf(g).appendChild(b.closest("li"));
      });
    });
  }

  function move(li, dir) {
    const gs = groups();
    const gi = gs.indexOf(li.closest(".nav-group"));
    if (dir < 0) {
      if (li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
      else if (gi > 0) { listOf(gs[gi - 1]).appendChild(li); gs[gi - 1].classList.add("open"); }
      else return;
    } else {
      if (li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li);
      else if (gi < gs.length - 1) { const ul = listOf(gs[gi + 1]); ul.insertBefore(li, ul.firstChild); gs[gi + 1].classList.add("open"); }
      else return;
    }
    save();
    li.scrollIntoView({ block: "nearest" });
  }

  function setEdit(on) {
    document.body.classList.toggle("nav-editing", on);
    const btn = document.getElementById("btn-nav-order");
    if (btn) btn.textContent = on ? "تم الترتيب ✓" : "ترتيب القائمة";
    const reset = document.getElementById("btn-nav-reset");
    if (reset) reset.hidden = !on;
    document.querySelectorAll("#primary-nav .nav-move").forEach((x) => x.remove());
    if (!on) return;
    groups().forEach((g) => g.classList.add("open"));
    document.querySelectorAll("#primary-nav .nav-group > ul > li").forEach((li) => {
      const box = document.createElement("span");
      box.className = "nav-move";
      box.innerHTML = `<button type="button" data-nav-move="-1" title="لأعلى" aria-label="نقل لأعلى">▲</button><button type="button" data-nav-move="1" title="لأسفل" aria-label="نقل لأسفل">▼</button>`;
      li.appendChild(box);
    });
  }

  function init() {
    const nav = document.getElementById("primary-nav");
    const foot = document.querySelector(".sidebar-foot .sf-actions");
    if (!nav || !foot || document.getElementById("btn-nav-order")) return;
    original = snapshot();
    apply(read());
    const btn = document.createElement("button");
    btn.id = "btn-nav-order"; btn.type = "button"; btn.textContent = "ترتيب القائمة";
    btn.title = "غيّر أماكن الصفحات في القائمة حسب رغبتك";
    const reset = document.createElement("button");
    reset.id = "btn-nav-reset"; reset.type = "button"; reset.textContent = "الترتيب الأصلي"; reset.hidden = true;
    foot.prepend(btn, reset);
    btn.addEventListener("click", () => setEdit(!document.body.classList.contains("nav-editing")));
    reset.addEventListener("click", () => {
      try { localStorage.removeItem(KEY); } catch (e) { /* */ }
      apply(original);
      setEdit(true);
      if (App.ui) App.ui.toast("أُعيدت القائمة إلى ترتيبها الأصلي");
    });
    nav.addEventListener("click", (e) => {
      const b = e.target.closest("[data-nav-move]");
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      move(b.closest("li"), Number(b.dataset.navMove));
    });
  }

  App.navOrder = { init, apply, snapshot };
})(window.App = window.App || {});
