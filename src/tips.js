/* فقاعات الشرح: مرّر المؤشر على أي عنصر فيه data-tip (وعنوانه data-tip-t) فتظهر فقاعة تشرح ما يفعله.
   تعمل بالمؤشر وبالتركيز بلوحة المفاتيح (Tab) وباللمس (النقر يركّز العنصر)، وتُغلق بـ Esc أو بالتمرير أو بالنقر.
   فقاعة واحدة تُنشأ عند الحاجة وتُوضَع تحت العنصر (أو فوقه إن ضاق المكان) بلا قصّ داخل الحاويات. */
(function (App) {
  let el = null, cur = null, timer = 0;

  function ensure() {
    if (el) return el;
    el = document.createElement("div");
    el.id = "tk-tip"; el.setAttribute("role", "tooltip"); el.hidden = true;
    document.body.appendChild(el);
    return el;
  }
  function place(target, t) {
    t.style.left = "0px"; t.style.top = "0px";
    const r = target.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    let x = r.left + r.width / 2 - w / 2; x = Math.max(8, Math.min(x, vw - w - 8));
    let y = r.bottom + 10, above = false;
    if (y + h > vh - 8 && r.top - h - 10 > 8) { y = r.top - h - 10; above = true; }
    // لا تخرج الفقاعة من الشاشة مهما كان موضع العنصر: يُحصَر موضعها رأسياً، ويُقيَّد ارتفاعها إن زاد عن الشاشة
    t.style.maxHeight = Math.max(80, vh - 16) + "px"; t.style.overflow = "auto";
    const hh = Math.min(h, vh - 16);
    y = Math.max(8, Math.min(y, vh - hh - 8));
    t.style.left = Math.round(x) + "px"; t.style.top = Math.round(y) + "px";
    t.dataset.pos = above ? "above" : "below";
    t.style.setProperty("--ax", Math.round(Math.max(14, Math.min(w - 14, r.left + r.width / 2 - x))) + "px");
  }
  function show(target) {
    const body = target.getAttribute("data-tip"); if (!body) return;
    const t = ensure(), title = target.getAttribute("data-tip-t");
    t.textContent = "";
    if (title) { const b = document.createElement("b"); b.textContent = title; t.appendChild(b); }
    const p = document.createElement("div"); p.className = "tk-tip-b"; p.textContent = body; t.appendChild(p);
    t.hidden = false; cur = target; target.setAttribute("aria-describedby", "tk-tip");
    place(target, t);
  }
  function hide() {
    clearTimeout(timer);
    if (el) el.hidden = true;
    if (cur) { try { cur.removeAttribute("aria-describedby"); } catch (e) { /* العنصر أُزيل */ } }
    cur = null;
  }
  const tipOf = (e) => (e.target && e.target.closest ? e.target.closest("[data-tip]") : null);

  document.addEventListener("mouseover", (e) => {
    const t = tipOf(e); if (!t) return;
    if (cur && !document.contains(cur)) hide();      // عنصر أُعيد رسمه والفقاعة ما زالت ظاهرة
    if (t === cur) return;
    clearTimeout(timer); timer = setTimeout(() => show(t), 180);
  });
  document.addEventListener("mouseout", (e) => {
    const t = tipOf(e); if (!t) return;
    if (e.relatedTarget && t.contains(e.relatedTarget)) return;
    hide();
  });
  document.addEventListener("focusin", (e) => { const t = tipOf(e); if (t) { clearTimeout(timer); show(t); } });
  document.addEventListener("focusout", (e) => { if (tipOf(e)) hide(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  document.addEventListener("click", hide, true);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);

  App.tips = { show, hide };
})(window.App = window.App || {});
