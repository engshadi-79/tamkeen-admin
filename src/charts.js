/* رسوم بيانية أفقية بسيطة على canvas (بلا مكتبات) تُدرج كصور في المعاينة وملف Word */
(function (App) {
  const FONT = '"Sakkal Majalla", "Cairo", "Segoe UI", Tahoma, sans-serif';
  const COLORS = { bar: "#1ABB9C", low: "#d63939", grid: "#eff0f3", text: "#1e2633", muted: "#7e8896", threshold: "#f59f00" };

  /* يرجع { src, widthPt, heightPt } — عرض الصورة في المستند 440 نقطة */
  function horizontalBars({ title, labels, values, max = 100, unit = "%", threshold, lowBelow }) {
    const W = 1400;
    const rowH = 64;
    const top = 90;
    const bottom = 60;
    const H = top + labels.length * rowH + bottom;
    const labelW = 430;
    const valueW = 110;
    const chartRight = W - labelW - 20; // الأعمدة تبدأ يميناً وتمتد لليسار (اتجاه عربي)
    const chartLeft = valueW;
    const span = chartRight - chartLeft;

    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.direction = "rtl";

    ctx.fillStyle = COLORS.text;
    ctx.font = `bold 38px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(title, W / 2, 52);

    // خطوط الشبكة وقيمها
    ctx.font = `24px ${FONT}`;
    ctx.fillStyle = COLORS.muted;
    for (let i = 0; i <= 4; i++) {
      const x = chartRight - (span * i) / 4;
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, top - 10);
      ctx.lineTo(x, top + labels.length * rowH);
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillText(`${Math.round((max * i) / 4)}${unit}`, x, top + labels.length * rowH + 36);
    }

    labels.forEach((label, i) => {
      const y = top + i * rowH;
      const v = Math.max(0, Math.min(max, Number(values[i]) || 0));
      const w = (span * v) / max;
      ctx.fillStyle = lowBelow != null && v < lowBelow ? COLORS.low : COLORS.bar;
      ctx.fillRect(chartRight - w, y + 12, w, rowH - 24);

      ctx.fillStyle = COLORS.text;
      ctx.font = `bold 30px ${FONT}`;
      ctx.textAlign = "right";
      ctx.fillText(fitText(ctx, label, labelW - 10), W - 16, y + rowH / 2 + 10);

      ctx.font = `bold 28px ${FONT}`;
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(v * 10) / 10}${unit}`, chartRight - w - 10, y + rowH / 2 + 10);
    });

    if (threshold != null) {
      const x = chartRight - (span * threshold) / max;
      ctx.strokeStyle = COLORS.threshold;
      ctx.lineWidth = 4;
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      ctx.moveTo(x, top - 14);
      ctx.lineTo(x, top + labels.length * rowH + 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.threshold;
      ctx.font = `bold 24px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(`الحد المطلوب ${threshold}${unit}`, x, top - 20);
    }

    const widthPt = 440;
    return { src: c.toDataURL("image/png"), widthPt, heightPt: Math.round((widthPt * H) / W) };
  }

  function fitText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t + "…";
  }

  App.charts = { horizontalBars };
})(window.App = window.App || {});
