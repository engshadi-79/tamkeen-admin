/* منطق «تحويل ملف حسب قالب» — منقول من مشروع منجز (src/lib/reports/template-file-utils.ts)
   ليعمل داخل المتصفح بمكتبتَي ExcelJS و JSZip المحليتين (مجلد vendor) بلا خادم. */
(function (App) {
  const MAX_ROWS = 5000;

  /* توحيد صيغ الحروف العربية لمقارنة أسماء الأعمدة ("الاسم" = "الإسم") */
  function normalizeHeader(value) {
    return String(value)
      .trim()
      .toLowerCase()
      // التشكيل والتطويل فقط؛ النطاق السابق (ً-ٰ) كان يشمل الأرقام العربية ٠-٩ فيمحوها
      .replace(/[ً-ٰٟـ]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .replace(/\s+/g, " ");
  }

  /* اقتراح ربط الأعمدة: تطابق تام ثم تطابق جزئي */
  function suggestColumnMapping(templateHeaders, dataHeaders) {
    const normalizedData = dataHeaders.map((raw) => ({ raw, norm: normalizeHeader(raw) }));
    const mapping = {};
    for (const templateHeader of templateHeaders) {
      const normTemplate = normalizeHeader(templateHeader);
      const exact = normalizedData.find((d) => d.norm === normTemplate);
      if (exact) { mapping[templateHeader] = exact.raw; continue; }
      // التطابق الجزئي لا يشمل الأسماء القصيرة جداً (مثل «م» داخل «الاسم»)
      const partial = normTemplate.length < 2 ? null : normalizedData.find((d) =>
        d.norm.length >= 2 && (d.norm.includes(normTemplate) || normTemplate.includes(d.norm)));
      if (partial) mapping[templateHeader] = partial.raw;
    }
    return mapping;
  }

  function resolveDefaultColumn(saved, dataHeaders) {
    const normSaved = normalizeHeader(saved);
    const exact = dataHeaders.find((h) => normalizeHeader(h) === normSaved);
    if (exact) return exact;
    return dataHeaders.find((h) => {
      const normH = normalizeHeader(h);
      return normH.includes(normSaved) || normSaved.includes(normH);
    });
  }

  /* ===== قراءة Excel ===== */
  function cellToPlainValue(cell) {
    const value = cell.value;
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === "object") {
      if ("error" in value) return null;
      if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((p) => p.text).join("");
      if ("text" in value) return String(value.text == null ? "" : value.text);
      if ("result" in value) return value.result == null ? null : value.result;
      return String(value);
    }
    return value;
  }

  function rowValues(sheet, rowNumber, columnCount) {
    const row = sheet.getRow(rowNumber);
    const values = [];
    for (let col = 1; col <= columnCount; col++) values.push(cellToPlainValue(row.getCell(col)));
    return values;
  }

  // صف عنوان مكرر بنفس النص في كل الخلايا ليس صف عناوين
  function looksLikeHeaderRow(values) {
    const nonEmpty = values.filter((v) => v != null && String(v).trim() !== "");
    if (nonEmpty.length < 2) return false;
    return new Set(nonEmpty.map((v) => String(v).trim())).size > 1;
  }

  const DATE_CELL_PATTERN = /^\d{1,2}\/\d{1,2}/;
  function looksLikeDateRow(values) {
    const nonEmpty = values.filter((v) => v != null && String(v).trim() !== "");
    return nonEmpty.filter((v) => DATE_CELL_PATTERN.test(String(v).trim())).length >= 3;
  }

  function findHeaderRowNumber(sheet, columnCount) {
    const maxScan = Math.min(10, Math.max(sheet.rowCount, 1));
    for (let r = 1; r <= maxScan; r++) {
      const values = rowValues(sheet, r, columnCount);
      if (looksLikeHeaderRow(values) && !looksLikeDateRow(values)) return r;
    }
    return 1;
  }

  function findDateRowNumber(sheet, columnCount, headerRowNumber) {
    for (let r = 1; r < headerRowNumber; r++) {
      if (looksLikeDateRow(rowValues(sheet, r, columnCount))) return r;
    }
    return null;
  }

  function extractSheetData(sheet) {
    const columnCount = Math.max(sheet.columnCount, sheet.getRow(1).cellCount);
    const headerRowNumber = findHeaderRowNumber(sheet, columnCount);
    const headers = rowValues(sheet, headerRowNumber, columnCount).map((raw, i) =>
      raw != null && String(raw).trim() ? String(raw).trim() : `عمود ${i + 1}`
    );
    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowNumber || rows.length >= MAX_ROWS) return;
      const record = {};
      let hasValue = false;
      for (let col = 1; col <= columnCount; col++) {
        const value = cellToPlainValue(row.getCell(col));
        if (value != null && value !== "") hasValue = true;
        record[headers[col - 1]] = value;
      }
      if (hasValue) rows.push(record);
    });
    return { headers, rows };
  }

  /* عناوين أول جدول في ملف Word */
  async function extractHeadersFromDocxTable(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const file = zip.file("word/document.xml");
    const xml = file ? await file.async("string") : null;
    if (!xml) return [];
    const table = (xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/) || [])[0];
    if (!table) return [];
    const headerRow = (table.match(/<w:tr[\s\S]*?<\/w:tr>/) || [])[0];
    if (!headerRow) return [];
    const cells = headerRow.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
    return cells.map((cellXml) =>
      (cellXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map((run) => decodeXmlEntities(run.replace(/<[^>]+>/g, ""))).join("").trim()
    );
  }

  const isDocxName = (name) => String(name).toLowerCase().endsWith(".docx");

  async function loadFirstSheet(buffer, emptyError) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error(emptyError);
    return sheet;
  }

  /* عناوين القالب من ملف Excel أو Word */
  async function readTemplateHeaders(buffer, isDocx) {
    if (isDocx) {
      const headers = await extractHeadersFromDocxTable(buffer);
      if (headers.length === 0) throw new Error("لم يتم العثور على جدول به صف عناوين في ملف الوورد");
      return headers;
    }
    const sheet = await loadFirstSheet(buffer, "لم يتم العثور على أي ورقة في ملف القالب");
    const headers = extractSheetData(sheet).headers;
    if (headers.length === 0) throw new Error("ملف القالب لا يحتوي على صف عناوين");
    return headers;
  }

  /* الحقول المكتوبة في القالب بصيغة {{اسم الحقل}} خارج صف العناوين (ترويسة، عنوان، تذييل) */
  const PLACEHOLDER_RE = /\{\{\s*([^{}]{1,80}?)\s*\}\}/g;

  async function readTemplatePlaceholders(buffer, isDocx) {
    const found = new Set();
    const collect = (text) => {
      let m;
      PLACEHOLDER_RE.lastIndex = 0;
      while ((m = PLACEHOLDER_RE.exec(String(text))) !== null) found.add(m[1].trim());
    };
    try {
      if (isDocx) {
        const zip = await JSZip.loadAsync(buffer);
        const file = zip.file("word/document.xml");
        if (file) {
          const xml = await file.async("string");
          // Word قد يقسّم {{الاسم}} على عدة مقاطع: يُزال ترميز المقاطع قبل البحث
          collect(xml.replace(/<[^>]+>/g, ""));
        }
      } else {
        const sheet = await loadFirstSheet(buffer, "لم يتم العثور على أي ورقة في ملف القالب");
        sheet.eachRow({ includeEmpty: false }, (row) => {
          row.eachCell({ includeEmpty: false }, (cell) => collect(cell.text || ""));
        });
      }
    } catch (e) { /* قالب بلا حقول */ }
    return [...found];
  }

  async function readDataFile(buffer) {
    const sheet = await loadFirstSheet(buffer, "لم يتم العثور على أي ورقة في ملف البيانات");
    const { headers, rows } = extractSheetData(sheet);
    if (headers.length === 0) throw new Error("ملف البيانات لا يحتوي على صف عناوين");
    return { headers, rows, truncated: rows.length >= MAX_ROWS };
  }

  /* ===== التقدير من المعدل (من 100) =====
     السلّم المعتمد: 90 فأكثر ممتاز، 80–89 جيد جداً، 75–79 جيد، أقل من 75 راسب.
     المعدل العشري يتبع الحد الأدنى لكل فئة (89.5 جيد جداً لأنه لم يبلغ 90). */
  const GRADE_SCALE = [
    { min: 90, label: "ممتاز" },
    { min: 80, label: "جيد جداً" },
    { min: 75, label: "جيد" },
    { min: 0, label: "راسب" },
  ];
  const GRADE_COLUMN = "التقدير (محسوب من المعدل)";

  function parseScore(value) {
    if (value == null || value === "") return null;
    const s = String(value)
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[٫,]/g, ".")
      .replace(/[%٪\s]/g, "");
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return n >= 0 && n <= 100 ? n : null;
  }

  // fraction: المعدل مكتوب كنسبة عشرية (0.86 تعني 86)
  function gradeOf(value, fraction) {
    let n = parseScore(value);
    if (n == null) return "";
    if (fraction) n *= 100;
    return GRADE_SCALE.find((g) => n >= g.min).label;
  }

  /* ===== مدربو المسارات (من صفحة المسارات) =====
     لكل صف يُؤخذ مساره من عمود المسار (أو مسار ثابت لكل الصفوف)، ويُضاف مدرّباه كأعمدة.
     أسماء مميّزة حتى لا تختلط بأعمدة بالاسم نفسه في ملف البيانات. */
  const TRAINER_COLS = { t1: "المدرب الأول (من المسارات)", t2: "المدرب الثاني (من المسارات)", both: "المدربان (من المسارات)" };
  const TRAINER_LIST = [TRAINER_COLS.t1, TRAINER_COLS.t2, TRAINER_COLS.both];
  const trackKey = (v) => normalizeHeader(v == null ? "" : v).replace(/^مسار\s*/, "").trim();

  /* المسار المطابق لقيمة مثل «الحلاقة» أو «مسار الحلاقة الرجالية»: تطابق تام ثم احتواء */
  function findTrack(tracks, value) {
    const k = trackKey(value);
    if (!k) return null;
    const list = (tracks || []).filter((t) => t && t.name).map((t) => ({ t, k: trackKey(t.name) })).filter((x) => x.k);
    const exact = list.find((x) => x.k === k);
    if (exact) return exact.t;
    const near = list.filter((x) => x.k.includes(k) || k.includes(x.k)).sort((a, b) => b.k.length - a.k.length);
    return near.length === 1 || (near.length && near[0].k.length !== (near[1] || {}).k?.length) ? near[0].t : null;
  }

  const guessTrackColumn = (headers) => headers.find((h) => !TRAINER_LIST.includes(h) && /مسار/.test(normalizeHeader(h))) || "";

  /* source: { column } عمود المسار في البيانات، أو { track } معرّف مسار ثابت لكل الصفوف، أو {} بلا مدربين */
  function addTrainerColumns(data, tracks, source) {
    // ما أضيف في مرة سابقة يُزال أولاً حتى لا تبقى قيم مسار سابق
    for (let i = data.headers.length - 1; i >= 0; i--) if (TRAINER_LIST.includes(data.headers[i])) data.headers.splice(i, 1);
    data.rows.forEach((row) => TRAINER_LIST.forEach((h) => { delete row[h]; }));
    const src = source === undefined ? { column: guessTrackColumn(data.headers) } : source || {};
    const fixed = src.track ? (tracks || []).find((t) => t.id === src.track) : null;
    const column = fixed ? "" : src.column && data.headers.includes(src.column) ? src.column : "";
    const report = { column, track: fixed ? fixed.id : "", trackName: fixed ? fixed.name : "", filled: 0, unmatched: [], noTrainers: [] };
    if (!column && !fixed) return report;
    TRAINER_LIST.forEach((h) => data.headers.push(h));
    const unmatched = new Set();
    const noTrainers = new Set();
    data.rows.forEach((row) => {
      const track = fixed || findTrack(tracks, row[column]);
      if (!track) { if (row[column] != null && String(row[column]).trim()) unmatched.add(String(row[column]).trim()); return; }
      const a = String(track.trainer1 || "").trim();
      const b = String(track.trainer2 || "").trim();
      if (!a && !b) { noTrainers.add(track.name); return; }
      row[TRAINER_COLS.t1] = a;
      row[TRAINER_COLS.t2] = b;
      row[TRAINER_COLS.both] = [a, b].filter(Boolean).join("، ");
      report.filled++;
    });
    report.unmatched = [...unmatched].slice(0, 8);
    report.noTrainers = [...noTrainers];
    return report;
  }

  /* أيّ مدرب: «الأول» أو «الثاني» أو كلاهما («اسم المدرب»، «المدربون») */
  function trainerColumnFor(name) {
    const n = normalizeHeader(name);
    if (!/مدرب/.test(n)) return "";
    if (/اول|\b1\b|١/.test(n)) return TRAINER_COLS.t1;
    if (/ثان|\b2\b|٢/.test(n)) return TRAINER_COLS.t2;
    return TRAINER_COLS.both;
  }

  function preferTrainers(mapping, templateHeaders, dataHeaders) {
    if (!dataHeaders.includes(TRAINER_COLS.both)) return mapping;
    templateHeaders.forEach((h) => { const col = trainerColumnFor(h); if (col) mapping[h] = col; });
    return mapping;
  }

  /* ===== العمر: يُحسب من عمود تاريخ الميلاد =====
     يقبل 1998-05-20 و20/05/1998 و«20-5-1998» والأرقام العربية وتواريخ Excel الرقمية. */
  const AGE_COLUMN = "العمر (محسوب من تاريخ الميلاد)";

  const guessBirthColumn = (headers) => headers.find((h) => /ميلاد|مواليد|birth|dob/i.test(normalizeHeader(h))) || "";

  function parseBirthDate(value) {
    if (value == null || value === "") return null;
    if (value instanceof Date) return isNaN(value) ? null : value;
    const raw = String(value)
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[م\s]/g, "")
      .trim();
    if (!raw) return null;
    // رقم تسلسلي من Excel (أيام منذ 1899-12-30)
    if (/^\d{4,5}$/.test(raw)) {
      const d = new Date(Date.UTC(1899, 11, 30) + Number(raw) * 86400000);
      return isNaN(d) ? null : d;
    }
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw);
    if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(raw);
    if (m) {
      let year = Number(m[3]);
      if (year < 100) year += year > 30 ? 1900 : 2000;
      // اليوم أولاً كما هو شائع عندنا؛ وإن كان الثاني أكبر من 12 فهو اليوم والأول شهر
      const a = Number(m[1]);
      const b = Number(m[2]);
      return b > 12 && a <= 12 ? valid(year, a, b) : valid(year, b, a);
    }
    const d = new Date(raw);
    return isNaN(d) ? null : d;
  }

  function valid(year, month, day) {
    if (!(year > 1900 && year < 2100) || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
    const d = new Date(year, month - 1, day);
    return isNaN(d) || d.getMonth() !== month - 1 ? null : d;
  }

  /* العمر بالسنوات الكاملة حتى تاريخ اليوم (أو تاريخ مرجعي) */
  function ageFrom(value, at) {
    const b = parseBirthDate(value);
    if (!b) return "";
    const ref = at ? new Date(at) : new Date();
    let age = ref.getFullYear() - b.getFullYear();
    const before = ref.getMonth() < b.getMonth() || (ref.getMonth() === b.getMonth() && ref.getDate() < b.getDate());
    if (before) age--;
    return age >= 0 && age < 120 ? age : "";
  }

  /* يضيف عمود العمر إلى البيانات، ويعيد كم صفاً حُسب وكم تعذّر */
  function addAgeColumn(data, birthHeader, at) {
    const birth = birthHeader === undefined ? guessBirthColumn(data.headers) : birthHeader;
    if (!birth || !data.headers.includes(birth)) {
      data.headers = data.headers.filter((h) => h !== AGE_COLUMN);
      data.rows.forEach((r) => { delete r[AGE_COLUMN]; });
      return { from: "", ok: 0, bad: 0 };
    }
    if (!data.headers.includes(AGE_COLUMN)) data.headers.push(AGE_COLUMN);
    let ok = 0;
    let bad = 0;
    data.rows.forEach((row) => {
      const age = ageFrom(row[birth], at);
      row[AGE_COLUMN] = age === "" ? "" : String(age);
      if (age !== "") ok++;
      else if (row[birth] != null && String(row[birth]).trim() !== "") bad++;
    });
    return { from: birth, ok, bad };
  }

  /* حقل «العمر» في القالب يُربط بالعمود المحسوب */
  function preferAge(mapping, templateHeaders, dataHeaders) {
    if (!dataHeaders.includes(AGE_COLUMN)) return mapping;
    templateHeaders.forEach((h) => { if (/^العمر|\bالعمر\b|السن$/.test(normalizeHeader(h))) mapping[h] = AGE_COLUMN; });
    return mapping;
  }

  const guessAverageColumn = (headers) => headers.find((h) => h !== GRADE_COLUMN && /معدل/.test(normalizeHeader(h))) || "";

  /* يُضاف عمود التقدير المحسوب إلى البيانات من عمود المعدل (المختار، أو أول عمود اسمه فيه «معدل»).
     يعيد { from, ok, bad, fraction }: كم صفاً حُسب له تقدير، وكم تعذّر (قيمة غير رقمية). */
  function addComputedGrade(data, avgHeader) {
    const avg = avgHeader === undefined ? guessAverageColumn(data.headers) : avgHeader;
    if (!avg || !data.headers.includes(avg)) return { from: "", ok: 0, bad: 0, fraction: false };
    if (!data.headers.includes(GRADE_COLUMN)) data.headers.push(GRADE_COLUMN);
    // عمود كل قيمه بين 0 و 1 معدلات مكتوبة كنسب (خلية بصيغة % في Excel)
    const nums = data.rows.map((r) => parseScore(r[avg])).filter((n) => n != null);
    const fraction = nums.length > 0 && Math.max(...nums) <= 1 && nums.some((n) => n > 0);
    let ok = 0;
    let bad = 0;
    data.rows.forEach((row) => {
      const g = gradeOf(row[avg], fraction);
      row[GRADE_COLUMN] = g;
      if (g) ok++; else if (row[avg] != null && String(row[avg]).trim() !== "") bad++;
    });
    return { from: avg, ok, bad, fraction };
  }

  /* عمود «التقدير» في القالب يُربط بالتقدير المحسوب بدل عمود جاهز في البيانات */
  function preferComputedGrade(mapping, templateHeaders, dataHeaders) {
    if (!dataHeaders.includes(GRADE_COLUMN)) return mapping;
    templateHeaders.forEach((h) => { if (/تقدير/.test(normalizeHeader(h))) mapping[h] = GRADE_COLUMN; });
    return mapping;
  }

  /* ===== دمج عدة ملفات بيانات لنفس الأشخاص =====
     كل ملف فيه جزء من بياناتهم؛ تُربط الصفوف بعمود مشترك (رقم الهوية غالباً) فيصير لكل شخص صف واحد. */
  const KEY_HINTS = [/هويه|سجل مدني|رقم وطني|national|^id$/, /جوال|هاتف|موبايل|mobile|phone/, /اسم/];

  // قيمة الربط بصيغة موحّدة: أرقام عربية ← لاتينية، بلا مسافات ولا تشكيل، والأصفار البادئة
  // في الأرقام الطويلة لا تُحسب (Excel يحذفها من رقم مخزّن كعدد ويبقيها في رقم مخزّن كنص)
  function normalizeKeyValue(value) {
    const s = normalizeHeader(value == null ? "" : value)
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/\s+/g, "");
    return /^\d{6,}$/.test(s) ? s.replace(/^0+/, "") : s;
  }

  /* الأعمدة الموجودة في كل الملفات وقيمها شبه فريدة، مرتّبة: الهوية ثم الجوال ثم الاسم */
  function keyCandidates(files) {
    const sets = files.map((f) => new Map(f.headers.map((h) => [normalizeHeader(h), h])));
    const common = [...sets[0].keys()].filter((n) => sets.every((s) => s.has(n)));
    const uniqueness = (n) => {
      const h = sets[0].get(n);
      const vals = files[0].rows.map((r) => normalizeKeyValue(r[h])).filter(Boolean);
      return vals.length ? new Set(vals).size / vals.length : 0;
    };
    const rank = (n) => { const i = KEY_HINTS.findIndex((re) => re.test(n)); return i === -1 ? KEY_HINTS.length : i; };
    return common
      .map((n) => ({ n, u: uniqueness(n) }))
      .filter((c) => c.u >= 0.9) // عمود يتكرر كثيراً (مثل المسار أو المجموعة) لا يصلح للربط
      .sort((a, b) => rank(a.n) - rank(b.n) || b.u - a.u)
      .map((c) => sets[0].get(c.n));
  }

  /* أفضل عمود لربط الأشخاص في ملف واحد: الهوية ثم الجوال ثم الاسم، وقيمه شبه فريدة */
  function guessKey(file) {
    const uniqueness = (h) => {
      const vals = file.rows.map((r) => normalizeKeyValue(r[h])).filter(Boolean);
      return vals.length ? new Set(vals).size / vals.length : 0;
    };
    const rank = (h) => { const i = KEY_HINTS.findIndex((re) => re.test(normalizeHeader(h))); return i === -1 ? KEY_HINTS.length : i; };
    const best = file.headers
      .map((h) => ({ h, r: rank(h), u: uniqueness(h) }))
      .filter((c) => c.r < KEY_HINTS.length && c.u >= 0.9)
      .sort((a, b) => a.r - b.r || b.u - a.u)[0];
    return best ? best.h : "";
  }

  /* دمج الملفات: لكل ملف عمود ربط (f.key) ولو اختلف اسمه بين الملفات،
     وبدونه يُبحث عن عمود مشترك بالاسم نفسه في كل الملفات */
  function mergeDataFiles(files, key) {
    let keys = [];
    if (!files.every((f) => f.key)) {
      keys = keyCandidates(files);
      if (!keys.length) {
        throw new Error("لا يوجد عمود مشترك بين كل الملفات يصلح لربط الأشخاص (مثل رقم الهوية)؛ اختر عمود الربط في كل ملف");
      }
      const k = normalizeHeader(key && keys.includes(key) ? key : keys[0]);
      files = files.map((f) => Object.assign({}, f, { key: f.headers.find((h) => normalizeHeader(h) === k) }));
    }
    const keyHeader = files[0].key;

    // أعمدة الناتج بترتيب الملف الأول ثم ما يزيد في البقية؛ عمود الربط في كل ملف يصبح عموداً واحداً،
    // والعمود المتكرر بالاسم نفسه بين ملفين يصبح عموداً واحداً أيضاً
    const headers = [];
    const canon = new Map();
    files.forEach((f, fi) => f.headers.forEach((h) => {
      if (fi > 0 && h === f.key) return;
      const n = normalizeHeader(h);
      if (!canon.has(n)) { canon.set(n, h); headers.push(h); }
    }));
    const outName = (f, h) => (h === f.key ? keyHeader : canon.get(normalizeHeader(h)));

    const byKey = new Map();
    const people = [];
    let conflicts = 0;
    let noKey = 0;
    files.forEach((f, fi) => {
      f.rows.forEach((row) => {
        const kv = normalizeKeyValue(row[f.key]);
        let person = kv && byKey.get(kv);
        if (!person) {
          person = { values: {}, files: new Set() };
          people.push(person);
          if (kv) byKey.set(kv, person); else noKey++; // صف بلا قيمة ربط: يبقى كما هو دون دمج
        }
        person.files.add(fi);
        f.headers.forEach((h) => {
          const v = row[h];
          if (v == null || v === "") return;
          const out = outName(f, h);
          const cur = person.values[out];
          if (cur == null || cur === "") person.values[out] = v;
          else if (normalizeKeyValue(cur) !== normalizeKeyValue(v)) conflicts++; // تبقى قيمة الملف الأول
        });
      });
    });

    const nameHeader = headers.find((h) => /اسم/.test(normalizeHeader(h)));
    const label = (p) => String((nameHeader && p.values[nameHeader]) || p.values[keyHeader] || "بلا اسم");
    const perFile = files.map((f, fi) => {
      const missing = people.filter((p) => !p.files.has(fi));
      return { name: f.name, rows: f.rows.length, missing: missing.length, missingNames: missing.slice(0, 8).map(label) };
    });
    return {
      headers,
      rows: people.map((p) => p.values),
      coverage: people.map((p) => p.files.size),
      key: keyHeader,
      keys,
      stats: { total: people.length, inAll: people.filter((p) => p.files.size === files.length).length, perFile, conflicts, noKey },
    };
  }

  /* ===== التواريخ ===== */
  const ARABIC_WEEKDAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const ARABIC_MONTH_NAMES = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

  // "YYYY-MM-DD" كتاريخ محلي لا UTC
  function parseIsoDateLocal(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function computeSessionDates(startDate, endDate, weekdays, maxCount = 7) {
    const weekdaySet = new Set(weekdays);
    const end = parseIsoDateLocal(endDate);
    const cursor = parseIsoDateLocal(startDate);
    const labels = [];
    if (cursor > end) throw new Error('تاريخ البداية بعد تاريخ النهاية - تأكد من ترتيب الحقلين "من تاريخ" و"إلى تاريخ"');
    while (cursor <= end && labels.length < maxCount) {
      if (weekdaySet.has(cursor.getDay())) {
        const dd = String(cursor.getDate()).padStart(2, "0");
        const mm = String(cursor.getMonth() + 1).padStart(2, "0");
        labels.push(`${dd}/${mm}\n${ARABIC_WEEKDAY_NAMES[cursor.getDay()]}`);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (labels.length === 0) throw new Error("لا يوجد أي يوم يوافق الأيام المحددة ضمن هذا المدى الزمني");
    return labels;
  }

  const weekPositionFromSaturday = (weekday) => (weekday + 1) % 7;

  function formatMonthYearArabic(startDate) {
    const start = parseIsoDateLocal(startDate);
    return `${ARABIC_MONTH_NAMES[start.getMonth()] || start.getMonth() + 1} ${start.getFullYear()}`;
  }

  function sessionDatePlaceholders(startDate, weekdays) {
    const start = parseIsoDateLocal(startDate);
    return {
      الشهر: ARABIC_MONTH_NAMES[start.getMonth()] || String(start.getMonth() + 1),
      السنة: String(start.getFullYear()),
      الأيام: [...weekdays]
        .sort((a, b) => weekPositionFromSaturday(a) - weekPositionFromSaturday(b))
        .map((d) => ARABIC_WEEKDAY_NAMES[d])
        .join(" - "),
    };
  }

  // خلية تاريخ منطقية واحدة لكل دمج (العمود الرئيسي للدمج فقط)
  function dateRowTargetColumns(sheet, rowNumber, columnCount) {
    const row = sheet.getRow(rowNumber);
    const cols = [];
    for (let col = 1; col <= columnCount; col++) {
      const cell = row.getCell(col);
      const value = cellToPlainValue(cell);
      if (value == null || String(value).trim() === "") continue;
      if (cell.isMerged && cell.master.fullAddress.col !== col) continue;
      cols.push(col);
    }
    return cols;
  }

  function applyDatesToRow(sheet, rowNumber, columnCount, labels) {
    const row = sheet.getRow(rowNumber);
    dateRowTargetColumns(sheet, rowNumber, columnCount).forEach((col, i) => {
      row.getCell(col).value = i < labels.length ? labels[i] : "";
    });
  }

  /* ===== التجميع ===== */
  const GROUP_KEY_SEPARATOR = " ||| ";

  function computeGroupKey(columns, row) {
    return columns.map((column) => String(row[column] == null ? "" : row[column]).trim()).join(GROUP_KEY_SEPARATOR);
  }

  // تجميع مستقر: بترتيب أول ظهور لكل مجموعة
  function groupRowsByColumns(dataRows, columns) {
    const order = [];
    const buckets = new Map();
    for (const row of dataRows) {
      const key = computeGroupKey(columns, row);
      if (!buckets.has(key)) { buckets.set(key, []); order.push(key); }
      buckets.get(key).push(row);
    }
    return order.map((key) => buckets.get(key));
  }

  function resolveGroupWeekdays(sessionDates, groupByColumns, groupRow) {
    const groupKey = groupByColumns && groupByColumns.length ? computeGroupKey(groupByColumns, groupRow || {}) : undefined;
    const weekdays = (groupKey && sessionDates.weekdaysByGroup ? sessionDates.weekdaysByGroup[groupKey] : undefined) || sessionDates.weekdays;
    if (!weekdays || weekdays.length === 0) {
      throw new Error(groupKey
        ? `لم يتم تحديد أيام الأسبوع لهذه المجموعة: ${groupKey.replace(/ \|\|\| /g, " - ")}`
        : "لم يتم تحديد أيام الأسبوع لتوليد التواريخ");
    }
    return weekdays;
  }

  /* ===== قيم الصفوف ===== */
  function mappedValue(header, mapping, row) {
    const sourceKey = mapping[header];
    if (!sourceKey) return "";
    const value = row[sourceKey] == null ? "" : row[sourceKey];
    return typeof value === "string" ? value.trim() : value;
  }

  function buildRowValues(templateHeaders, mapping, row, autoNumberHeader, counter) {
    return templateHeaders.map((header) => (header === autoNumberHeader ? counter : mappedValue(header, mapping, row)));
  }

  function resolvePlaceholderValue(key, values) {
    if (key in values) return values[key];
    const trainer = trainerColumnFor(key);
    if (trainer && trainer in values) return values[trainer];
    const normKey = normalizeHeader(key);
    const matchKey = Object.keys(values).find((k) => {
      const normK = normalizeHeader(k);
      return normK === normKey || normK.includes(normKey) || normKey.includes(normK);
    });
    return matchKey ? values[matchKey] : undefined;
  }

  function rowToPlaceholderValues(row) {
    const values = {};
    if (!row) return values;
    for (const [key, value] of Object.entries(row)) values[key] = value == null ? "" : String(value);
    return values;
  }

  /* ===== تعبئة قالب Excel مع الحفاظ على تنسيقه ===== */
  function snapshotRow(sheet, rowNumber, columnCount) {
    const row = sheet.getRow(rowNumber);
    const cells = [];
    for (let col = 1; col <= columnCount; col++) {
      const cell = row.getCell(col);
      cells.push({ value: cell.value, style: Object.assign({}, cell.style) });
    }
    return cells;
  }

  function shiftMergeRange(range, rowOffset) {
    const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (!match) return range;
    return `${match[1]}${Number(match[2]) + rowOffset}:${match[3]}${Number(match[4]) + rowOffset}`;
  }

  const toAnchorSnapshot = (a) => ({ nativeCol: a.nativeCol, nativeColOff: a.nativeColOff, nativeRow: a.nativeRow, nativeRowOff: a.nativeRowOff });

  function snapshotBlockImages(sheet, blockEndRow) {
    return sheet.getImages()
      .filter((img) => img.range.tl.nativeRow < blockEndRow)
      .map((img) => ({
        imageId: Number(img.imageId),
        tl: toAnchorSnapshot(img.range.tl),
        br: img.range.br ? toAnchorSnapshot(img.range.br) : null,
        editAs: img.range.editAs,
      }));
  }

  function addShiftedImages(sheet, images, rowOffset) {
    for (const img of images) {
      sheet.addImage(img.imageId, {
        tl: Object.assign({}, img.tl, { nativeRow: img.tl.nativeRow + rowOffset }),
        br: img.br ? Object.assign({}, img.br, { nativeRow: img.br.nativeRow + rowOffset }) : undefined,
        editAs: img.editAs,
      });
    }
  }

  function substituteCellPlaceholdersInRow(sheet, rowNumber, columnCount, values) {
    const row = sheet.getRow(rowNumber);
    for (let col = 1; col <= columnCount; col++) {
      const cell = row.getCell(col);
      const raw = cellToPlainValue(cell);
      if (typeof raw !== "string" || !raw.includes("{{")) continue;
      const replaced = raw.replace(/\{\{([^{}]+)\}\}/g, (full, key) => {
        const resolved = resolvePlaceholderValue(key.trim(), values);
        return resolved === undefined ? full : resolved;
      });
      if (replaced !== raw) cell.value = replaced;
    }
  }

  async function fillXlsxTemplate(templateBuffer, templateHeaders, mapping, dataRows, options = {}) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(templateBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("لم يتم العثور على أي ورقة في ملف القالب");

    const columnCount = Math.max(sheet.columnCount, sheet.getRow(1).cellCount, templateHeaders.length);
    const headerRowNumber = findHeaderRowNumber(sheet, columnCount);

    let dateRowNumber = null;
    let dateColumnCount = 0;
    if (options.sessionDates) {
      dateRowNumber = findDateRowNumber(sheet, columnCount, headerRowNumber);
      if (dateRowNumber == null) throw new Error("لم يتم العثور على صف تواريخ في هذا القالب");
      dateColumnCount = dateRowTargetColumns(sheet, dateRowNumber, columnCount).length;
    }
    // مجموعات بأيام مختلفة: تتكرر الترويسة كاملة لكل مجموعة
    const perGroupDates = dateRowNumber != null && !!(options.sessionDates && options.sessionDates.weekdaysByGroup);
    if (perGroupDates) {
      sheet.pageSetup.printTitlesRow = undefined;
      sheet.pageSetup.printTitlesColumn = undefined;
    }

    const letterheadEndRow = perGroupDates ? 0 : headerRowNumber - 1;

    let blockEndRow = headerRowNumber;
    while (blockEndRow < sheet.rowCount) {
      const nextRowValues = rowValues(sheet, blockEndRow + 1, columnCount);
      if (!nextRowValues.some((v) => typeof v === "string" && /\{\{[^{}]+\}\}/.test(v))) break;
      blockEndRow++;
    }
    const firstDataRow = blockEndRow + 1;

    const styleSourceRow = firstDataRow <= sheet.rowCount ? firstDataRow : headerRowNumber;
    const dataCellStyles = [];
    for (let col = 1; col <= columnCount; col++) dataCellStyles.push(Object.assign({}, sheet.getRow(styleSourceRow).getCell(col).style));

    // ارتفاع صفوف القالب: يُنسخ للصفوف المولَّدة، وإلا ضبطها Excel تلقائياً فتطول الصفحة
    const defaultRowHeight = (sheet.properties && sheet.properties.defaultRowHeight) || 15;
    const rowHeightOf = (r) => sheet.getRow(r).height || defaultRowHeight;
    const dataRowHeight = firstDataRow <= sheet.rowCount ? sheet.getRow(firstDataRow).height : undefined;

    const repeatStartRow = perGroupDates ? 1 : headerRowNumber + 1;
    const blockSnapshot = [];
    const blockHeights = [];
    for (let r = repeatStartRow; r <= blockEndRow; r++) {
      blockSnapshot.push(snapshotRow(sheet, r, columnCount));
      blockHeights.push(sheet.getRow(r).height);
    }
    const sumHeights = (from, to) => { let h = 0; for (let r = from; r <= to; r++) h += rowHeightOf(r); return h; };
    const blockHeightPt = sumHeights(repeatStartRow, blockEndRow);
    const firstPageTopPt = sumHeights(1, repeatStartRow - 1); // الترويسة المشتركة أعلى الصفحة الأولى فقط
    // الترويسة وصف العناوين يُطبعان أعلى كل صفحة: في الوضع المشترك يكتبان مرة واحدة فقط
    // في الورقة، فيُضبط «تكرار صفوف العناوين» ليكررهما Excel في كل صفحة مطبوعة
    if (!perGroupDates && !sheet.pageSetup.printTitlesRow && headerRowNumber >= 1) {
      sheet.pageSetup.printTitlesRow = `1:${headerRowNumber}`;
    }
    const printTitles = String(sheet.pageSetup.printTitlesRow || "").match(/^\$?(\d+):\$?(\d+)$/);
    const printTitlesPt = printTitles ? sumHeights(Number(printTitles[1]), Number(printTitles[2])) : 0;
    const blockMerges = ((sheet.model && sheet.model.merges) || []).filter((range) => {
      const match = range.match(/^[A-Z]+(\d+):[A-Z]+(\d+)$/);
      return match != null && Number(match[1]) >= repeatStartRow && Number(match[2]) <= blockEndRow;
    });
    const blockImages = snapshotBlockImages(sheet, blockEndRow).filter((img) => img.tl.nativeRow >= repeatStartRow - 1);

    // حذف صفوف المثال أسفل العناوين
    if (firstDataRow <= sheet.rowCount) {
      sheet.spliceRows(firstDataRow, sheet.rowCount - firstDataRow + 1);
      sheet._rows.length = firstDataRow - 1;
    }

    function addDataRow(row, counter) {
      const newRow = sheet.addRow(buildRowValues(templateHeaders, mapping, row, options.autoNumberHeader, counter));
      for (let col = 1; col <= columnCount; col++) {
        const cell = newRow.getCell(col);
        cell.style = dataCellStyles[col - 1];
        // خلية بصيغة نسبة مئوية في القالب ورقم مثل 86: يُكتب 0.86 فيظهر 86% لا 8600%
        const fmt = String((dataCellStyles[col - 1] || {}).numFmt || "");
        if (fmt.includes("%") && typeof cell.value === "number" && cell.value > 1) cell.value = cell.value / 100;
      }
      if (dataRowHeight) newRow.height = dataRowHeight;
    }

    const placeholderValuesFor = (row, extra) => Object.assign(rowToPlaceholderValues(row), extra);
    const groupDataRanges = []; // [أول صف، آخر صف] لبيانات كل مجموعة

    const groups = options.groupByColumns && options.groupByColumns.length ? groupRowsByColumns(dataRows, options.groupByColumns) : [dataRows];
    if (options.sortRowsBy) groups.forEach((groupRows) => sortRowsByColumn(groupRows, options.sortRowsBy));

    if (letterheadEndRow >= 1) {
      let letterheadExtra = {};
      if (dateRowNumber != null && options.sessionDates) {
        const weekdays = resolveGroupWeekdays(options.sessionDates, options.groupByColumns, dataRows[0]);
        const dateLabels = computeSessionDates(options.sessionDates.startDate, options.sessionDates.endDate, weekdays, dateColumnCount);
        letterheadExtra = sessionDatePlaceholders(options.sessionDates.startDate, weekdays);
        applyDatesToRow(sheet, dateRowNumber, columnCount, dateLabels);
      }
      for (let r = 1; r <= letterheadEndRow; r++) {
        substituteCellPlaceholdersInRow(sheet, r, columnCount, placeholderValuesFor(dataRows[0], letterheadExtra));
      }
    }

    groups.forEach((groupRows, index) => {
      let extraPlaceholders = {};
      let dateLabels = null;
      if (options.sessionDates && perGroupDates) {
        const weekdays = resolveGroupWeekdays(options.sessionDates, options.groupByColumns, groupRows[0]);
        dateLabels = computeSessionDates(options.sessionDates.startDate, options.sessionDates.endDate, weekdays, dateColumnCount);
        extraPlaceholders = sessionDatePlaceholders(options.sessionDates.startDate, weekdays);
      }

      if (index === 0) {
        for (let r = repeatStartRow; r <= blockEndRow; r++) {
          substituteCellPlaceholdersInRow(sheet, r, columnCount, placeholderValuesFor(groupRows[0], extraPlaceholders));
        }
        if (dateLabels) applyDatesToRow(sheet, dateRowNumber, columnCount, dateLabels);
      } else {
        sheet.getRow(sheet.rowCount).addPageBreak();
        const insertStartRow = sheet.rowCount + 1;
        blockSnapshot.forEach((cells, bi) => {
          const newRow = sheet.addRow(cells.map((c) => c.value));
          cells.forEach((c, i) => (newRow.getCell(i + 1).style = c.style));
          if (blockHeights[bi]) newRow.height = blockHeights[bi];
        });
        const rowOffset = insertStartRow - repeatStartRow;
        for (const range of blockMerges) sheet.mergeCells(shiftMergeRange(range, rowOffset));
        addShiftedImages(sheet, blockImages, rowOffset);
        const blockRowCount = blockEndRow - repeatStartRow + 1;
        for (let r = insertStartRow; r <= insertStartRow + blockRowCount - 1; r++) {
          substituteCellPlaceholdersInRow(sheet, r, columnCount, placeholderValuesFor(groupRows[0], extraPlaceholders));
        }
        if (dateLabels) applyDatesToRow(sheet, insertStartRow + (dateRowNumber - repeatStartRow), columnCount, dateLabels);
      }

      let counter = 1;
      const firstRow = sheet.rowCount + 1;
      for (const row of groupRows) addDataRow(row, counter++);
      groupDataRanges.push([firstRow, sheet.rowCount]);
    });

    if (options.fitGroupToOnePage) {
      const baseRowHeight = dataRowHeight || defaultRowHeight;
      const tops = groups.map((_, index) => (perGroupDates ? 0 : index === 0 ? firstPageTopPt : printTitlesPt));
      const groupPagesPt = groups.map((groupRows, index) => tops[index] + blockHeightPt + groupRows.length * baseRowHeight);
      const { scale, pageHeightPt } = fitPrintScale(sheet, columnCount, Math.max(...groupPagesPt));
      // تعبئة الصفحة: تُطوَّل صفوف كل مجموعة حتى تملأ صفحتها (بحد أعلى معقول للمجموعات الصغيرة جداً)
      groups.forEach((groupRows, index) => {
        if (groupRows.length === 0) return;
        const free = pageHeightPt - tops[index] - blockHeightPt;
        const height = Math.min(MAX_FILL_ROW_HEIGHT, Math.max(baseRowHeight, Math.floor((free / groupRows.length) * 10) / 10));
        const [from, to] = groupDataRanges[index];
        for (let r = from; r <= to; r++) sheet.getRow(r).height = height;
      });
      sheet.pageSetup.scale = scale;
    }

    return new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /* مقياس طباعة ثابت يجعل أطول مجموعة (ومعها عرض الأعمدة) في صفحة واحدة.
     «ملاءمة الصفحة» في Excel تُطبَّق على الورقة كلها لا على كل مجموعة، لذا يُحسب المقياس
     يدوياً مع إبقاء فواصل الصفحات بين المجموعات. يُرجع المقياس وارتفاع الصفحة المتاح
     بنقاط الورقة قبل التصغير (لتعبئة الصفوف) */
  const PAPER_INCHES = { 1: [8.5, 11], 5: [8.5, 14], 8: [11.69, 16.54], 9: [8.27, 11.69], 11: [5.83, 8.27] };
  const FIT_SAFETY = 0.93; // هامش أمان لفروق الخط وتقريب Excel لارتفاع كل صف عند الطباعة
  const MAX_FILL_ROW_HEIGHT = 60;
  const WIDTH_SAFETY = 0.97; // العرض أدق حساباً من الارتفاع، فهامشه أضيق
  const MAX_WIDEN = 2.5; // حد توسيع الأعمدة لملء عرض الصفحة

  function fitPrintScale(sheet, columnCount, tallestPagePt) {
    const ps = sheet.pageSetup;
    let [w, h] = PAPER_INCHES[ps.paperSize] || PAPER_INCHES[9];
    if (ps.orientation === "landscape") [w, h] = [h, w];
    const m = ps.margins || {};
    const inch = (v, d) => (typeof v === "number" ? v : d);
    const printableH = (h - inch(m.top, 0.75) - inch(m.bottom, 0.75)) * 72;
    const printableW = (w - inch(m.left, 0.7) - inch(m.right, 0.7)) * 72;

    // عرض العمود بوحدة الحروف ← نقاط (تقريب Excel لخط Calibri 11)
    const defaultColWidth = (sheet.properties && sheet.properties.defaultColWidth) || 8.43;
    let widthPt = 0;
    for (let c = 1; c <= columnCount; c++) {
      const col = sheet.getColumn(c);
      if (col.hidden) continue;
      widthPt += (Math.trunc((col.width || defaultColWidth) * 7 + 5)) * 0.75;
    }

    const ratio = Math.min(1, (printableH * FIT_SAFETY) / tallestPagePt, widthPt ? (printableW * FIT_SAFETY) / widthPt : 1);
    const scale = Math.max(10, Math.min(100, Math.floor(ratio * 100)));

    // التصغير يقلّص العرض أيضاً فيبقى جانب الصفحة فارغاً: تُوسَّع الأعمدة بنفس النسبة
    // ليملأ الجدول عرض الصفحة، مع بقاء نسب الأعمدة بينها كما في القالب
    const widen = widthPt ? Math.min(MAX_WIDEN, ((printableW * WIDTH_SAFETY) / (scale / 100)) / widthPt) : 1;
    if (widen > 1.02) {
      for (let c = 1; c <= columnCount; c++) {
        const col = sheet.getColumn(c);
        if (col.hidden) continue;
        col.width = Math.round((col.width || defaultColWidth) * widen * 100) / 100;
      }
    }
    ps.fitToPage = false;
    ps.fitToWidth = undefined;
    ps.fitToHeight = undefined;
    ps.scale = scale;
    return { scale, pageHeightPt: (printableH * FIT_SAFETY) / (scale / 100) };
  }

  /* ===== ملفات بدون تنسيق القالب (صيغة مختلفة عن القالب) ===== */
  async function buildBareXlsx(templateHeaders, mapping, dataRows) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("البيانات المحوّلة", { views: [{ rightToLeft: true }] });
    sheet.addRow(templateHeaders);
    for (const row of dataRows) sheet.addRow(templateHeaders.map((h) => String(mappedValue(h, mapping, row))));
    return new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  async function buildBareDocx(templateHeaders, mapping, dataRows) {
    const cell = (text) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">${escapeXml(String(text))}</w:t></w:r></w:p></w:tc>`;
    const row = (values) => `<w:tr>${values.map(cell).join("")}</w:tr>`;
    const borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join("");
    const table = `<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>` +
      row(templateHeaders) + dataRows.map((r) => row(templateHeaders.map((h) => mappedValue(h, mapping, r)))).join("") + "</w:tbl>";
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${table}<w:p/><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`);
    return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  /* ===== تعبئة قالب Word مع الحفاظ على تنسيقه ===== */
  const escapeXml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const decodeXmlEntities = (value) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

  /* Word يرفض الملف إذا خالفت عناصر الخصائص ترتيب المخطط، فيُدرج العنصر
     قبل أول عنصر يجب أن يأتي بعده، وإلا في النهاية */
  const PPR_AFTER_JC = ["textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"];
  const TCPR_AFTER_NOWRAP = ["tcMar", "textDirection", "tcFitText", "vAlign", "hideMark", "headers", "cellIns", "cellDel", "cellMerge", "tcPrChange"];
  const RPR_AFTER_SZ = ["highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath", "rPrChange"];

  function insertOrdered(inner, element, laterTags) {
    const re = new RegExp(`<w:(?:${laterTags.join("|")})\\b`);
    const m = inner.match(re);
    return m ? inner.slice(0, m.index) + element + inner.slice(m.index) : inner + element;
  }

  function extractTextRuns(xml) {
    const runs = [];
    const regex = /<w:t([^>]*)>([^<]*)<\/w:t>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      runs.push({ xmlStart: match.index, xmlEnd: match.index + match[0].length, openTag: `<w:t${match[1]}>`, text: decodeXmlEntities(match[2]) });
    }
    return runs;
  }

  function resolvePlaceholderKey(key, valueLists) {
    if (key in valueLists) return key;
    const normKey = normalizeHeader(key);
    return Object.keys(valueLists).find((k) => {
      const normK = normalizeHeader(k);
      return normK === normKey || normK.includes(normKey) || normKey.includes(normK);
    });
  }

  /* استبدال {{اسم العمود}} حتى لو قسّمه Word على عدة مقاطع نصية؛
     تكرار نفس المتغير يأخذ القيمة التالية المختلفة (مثل مدرّبَين) */
  function substitutePlaceholders(xml, valueLists) {
    const runs = extractTextRuns(xml);
    if (runs.length === 0) return xml;
    const runStartInFlat = [];
    let flat = "";
    for (const run of runs) { runStartInFlat.push(flat.length); flat += run.text; }

    // تُجمع الاستبدالات بمواضعها في النص الأصلي أولاً، ثم يُعاد بناء كل مقطع مرة واحدة؛
    // التعديل المتتابع على المقطع نفسه يُفسد المواضع حين يلي متغيرٌ مقسومٌ متغيراً آخر
    const tokenRegex = /\{\{([^{}]+)\}\}/g;
    const edits = [];
    const occurrenceIndex = {};
    // متغير مدرب عام («مدرب المسار»، «اسم المدرب»): يأخذ مدرّبَي المسار من صفحة المسارات لا عمود البيانات.
    // يتكرر مرتين أو أكثر ← الأول ثم الثاني؛ مرة واحدة ← الاثنان معاً
    const hasTrainers = !!(valueLists[TRAINER_COLS.t1] || valueLists[TRAINER_COLS.t2]);
    const genericCount = {};
    if (hasTrainers) {
      for (const m of flat.matchAll(/\{\{([^{}]+)\}\}/g)) {
        const k = m[1].trim();
        if (trainerColumnFor(k) === TRAINER_COLS.both) genericCount[normalizeHeader(k)] = (genericCount[normalizeHeader(k)] || 0) + 1;
      }
    }
    const trainerValue = (key) => {
      const col = trainerColumnFor(key);
      if (!col || !hasTrainers) return undefined;
      const first = (c) => ((valueLists[c] || [])[0] || "");
      if (col !== TRAINER_COLS.both) return first(col);
      const nk = normalizeHeader(key);
      if ((genericCount[nk] || 0) < 2) return first(TRAINER_COLS.both) || first(TRAINER_COLS.t1);
      const occ = occurrenceIndex["__trainer:" + nk] || 0;
      occurrenceIndex["__trainer:" + nk] = occ + 1;
      return occ === 0 ? first(TRAINER_COLS.t1) : occ === 1 ? first(TRAINER_COLS.t2) : "";
    };
    let match;
    while ((match = tokenRegex.exec(flat)) !== null) {
      const tv = trainerValue(match[1].trim());
      if (tv !== undefined) {
        edits.push({ start: match.index, end: match.index + match[0].length, value: tv });
        continue;
      }
      const resolvedKey = resolvePlaceholderKey(match[1].trim(), valueLists);
      if (resolvedKey === undefined) continue;
      const list = valueLists[resolvedKey];
      if (list.length === 0) continue;
      const occurrence = occurrenceIndex[resolvedKey] || 0;
      occurrenceIndex[resolvedKey] = occurrence + 1;
      edits.push({ start: match.index, end: match.index + match[0].length, value: list[Math.min(occurrence, list.length - 1)] });
    }
    if (edits.length === 0) return xml;

    const newRunText = new Map();
    runs.forEach((run, i) => {
      const rs = runStartInFlat[i];
      const re = rs + run.text.length;
      let out = "";
      let pos = rs;
      let touched = false;
      for (const e of edits) {
        if (e.end <= rs || e.start >= re) continue;
        touched = true;
        const s = Math.max(e.start, rs);
        if (s > pos) out += flat.slice(pos, s);
        if (e.start >= rs) out += e.value; // القيمة في المقطع الذي يبدأ فيه المتغير
        pos = Math.min(e.end, re);
      }
      if (!touched) return;
      if (pos < re) out += flat.slice(pos, re);
      newRunText.set(i, out);
    });
    if (newRunText.size === 0) return xml;

    let result = xml;
    for (const idx of [...newRunText.keys()].sort((a, b) => b - a)) {
      const run = runs[idx];
      result = result.slice(0, run.xmlStart) + run.openTag + escapeXml(newRunText.get(idx)) + "</w:t>" + result.slice(run.xmlEnd);
    }
    return result;
  }

  /* ترتيب أبجدي عربي: يتجاهل أل التعريف والهمزات، والأرقام تُرتَّب كأرقام */
  function sortRowsByColumn(rows, column) {
    const key = (r) => String(r[column] == null ? "" : r[column]).trim();
    const clean = (v) => v.replace(/^ال/, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ًٌٍَُِّْ]/g, "");
    const numeric = rows.every((r) => { const v = key(r); return !v || /^[\d.,]+$/.test(v); });
    rows.sort((a, b) => (numeric
      ? (Number(String(key(a)).replace(/,/g, "")) || 0) - (Number(String(key(b)).replace(/,/g, "")) || 0)
      : clean(key(a)).localeCompare(clean(key(b)), "ar")));
    return rows;
  }

  function rowsToPlaceholderValueLists(rows) {
    const lists = {};
    const seen = {};
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        const str = value == null ? "" : String(value).trim();
        if (!str) continue;
        const seenForKey = (seen[key] = seen[key] || new Set());
        if (!seenForKey.has(str)) { seenForKey.add(str); (lists[key] = lists[key] || []).push(str); }
      }
    }
    return lists;
  }

  /* ===== نصوص القالب خارج الجدول =====
     القوالب التي تكتب «اليوم: الثلاثاء» و«التاريخ: 18/08/2026م» واسم المسار نصاً مباشراً (بلا {{}})
     تُقرأ هنا: كل نص بعد عنوان ينتهي بنقطتين، وكل نص يشبه تاريخاً أو اسم مسار مسجّل. */
  const LABEL_RE = /([^\s:][^:]{0,24}?)\s*:\s*$/;
  const DATE_RE = /^\s*\d{1,2}\s*[/\-.]\s*\d{1,2}\s*[/\-.]\s*\d{2,4}\s*م?\s*$/;

  async function readTemplateTextFields(buffer, trackNames) {
    const zip = await JSZip.loadAsync(buffer);
    const file = zip.file("word/document.xml");
    if (!file) return [];
    const xml = await file.async("string");
    const tableStart = xml.search(/<w:tbl>/);
    const runs = extractTextRuns(xml);
    const tracks = (trackNames || []).map((t) => normalizeHeader(t)).filter(Boolean);
    const out = [];
    const seen = new Set();
    const add = (f) => {
      const key = f.label + "|" + f.index;
      if (seen.has(key) || !f.label) return;
      seen.add(key);
      out.push(f);
    };
    runs.forEach((run, i) => {
      // النصوص داخل الجدول تُملأ من ملف البيانات لا من هنا
      if (tableStart >= 0 && run.xmlStart > tableStart) return;
      const text = run.text;
      if (!text || !text.trim()) return;
      const m = LABEL_RE.exec(text.trim());
      if (m) {
        // القيمة: بقية المقطع نفسه بعد النقطتين، وإلا أول مقطع فيه نص بعده
        const after = text.slice(text.indexOf(":") + 1);
        if (after.trim()) { add({ label: m[1].trim(), index: i, current: after.trim(), keepPrefix: text.slice(0, text.indexOf(":") + 1) }); return; }
        for (let j = i + 1; j < Math.min(i + 4, runs.length); j++) {
          if (runs[j].text && runs[j].text.trim()) { add({ label: m[1].trim(), index: j, current: runs[j].text.trim(), keepPrefix: "" }); break; }
        }
        return;
      }
      const t = text.trim();
      if (DATE_RE.test(t)) { add({ label: "التاريخ", index: i, current: t, keepPrefix: "" }); return; }
      if (tracks.length && tracks.includes(normalizeHeader(t))) add({ label: "اسم المسار", index: i, current: t, keepPrefix: "" });
      else if (/^مسار\s/.test(t)) add({ label: "اسم المسار", index: i, current: t, keepPrefix: "" });
    });
    return out;
  }

  /* تعبئة تلك النصوص: القيم بمفتاح index كما جاءت من القراءة */
  function applyTemplateTextFields(xml, fields) {
    const list = (fields || []).filter((f) => f && f.value !== undefined && f.value !== null && String(f.value) !== "");
    if (!list.length) return xml;
    const runs = extractTextRuns(xml);
    let out = xml;
    // من الآخر إلى الأول حتى لا تتغيّر المواضع
    list.slice().sort((a, b) => b.index - a.index).forEach((f) => {
      const run = runs[f.index];
      if (!run) return;
      const text = (f.keepPrefix || "") + (f.keepPrefix ? " " : "") + String(f.value);
      out = out.slice(0, run.xmlStart) + run.openTag + escapeXml(text) + "</w:t>" + out.slice(run.xmlEnd);
    });
    return out;
  }

  async function fillDocxTemplate(templateBuffer, templateHeaders, mapping, dataRows, options = {}) {
    const zip = await JSZip.loadAsync(templateBuffer);
    const documentPath = "word/document.xml";
    const docFile = zip.file(documentPath);
    let xml = docFile ? await docFile.async("string") : null;
    if (!xml) throw new Error("ملف الوورد غير صالح");
    xml = applyTemplateTextFields(xml, options.textFields);

    const tableXml = (xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/) || [])[0];
    if (!tableXml) throw new Error("لم يتم العثور على جدول في ملف القالب");
    const tableStart = xml.indexOf(tableXml);
    const tableEnd = tableStart + tableXml.length;

    const bodyOpenMatch = xml.match(/<w:body[^>]*>/);
    const bodyContentStart = bodyOpenMatch ? bodyOpenMatch.index + bodyOpenMatch[0].length : 0;
    const documentOpenXml = xml.slice(0, bodyContentStart);
    const letterheadXml = xml.slice(bodyContentStart, tableStart);

    // ما بعد الجدول (التوقيع/الاعتماد) يتكرر مع كل مجموعة، و sectPr الختامي مرة واحدة
    const afterTable = xml.slice(tableEnd);
    const sectPrIndex = afterTable.lastIndexOf("<w:sectPr");
    const repeatableTrailingXml = sectPrIndex === -1 ? "" : afterTable.slice(0, sectPrIndex);
    const documentCloseXml = sectPrIndex === -1 ? afterTable : afterTable.slice(sectPrIndex);

    const rowMatches = tableXml.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
    if (rowMatches.length === 0) throw new Error("لم يتم العثور على صفوف في جدول القالب");

    const stripRowHeight = (rowXml) => rowXml.replace(/<w:trHeight\b[^/]*\/>/, "");

    const originalHeaderRowXml = rowMatches[0];
    const headerRowXml = stripRowHeight(originalHeaderRowXml);
    const styleRowXml = rowMatches.length > 1 ? rowMatches[rowMatches.length - 1] : headerRowXml;
    const styleCells = styleRowXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
    const rowOpenTag = (styleRowXml.match(/^<w:tr[^>]*>/) || ["<w:tr>"])[0];
    const tableOpenPart = tableXml.slice(0, tableXml.indexOf(originalHeaderRowXml));

    const TEMPLATE_FONT_HALF_POINTS = 28; // 14pt لكل الجدول

    function forceRunFontSize(fragment, sz) {
      let updated = fragment
        .replace(/(<w:sz\b[^>]*w:val=")\d+(")/g, `$1${sz}$2`)
        .replace(/(<w:szCs\b[^>]*w:val=")\d+(")/g, `$1${sz}$2`);
      if (!/<w:sz\b/.test(updated)) {
        updated = updated.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (_m, inner) =>
          `<w:rPr>${insertOrdered(inner, `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`, RPR_AFTER_SZ)}</w:rPr>`);
      }
      return updated;
    }
    const forceFontSize = (cellXml) => forceRunFontSize(cellXml, TEMPLATE_FONT_HALF_POINTS);

    function forceFontSizeForValues(fragmentXml, values, sz) {
      const distinct = [...new Set(values)].filter(Boolean);
      if (distinct.length === 0) return fragmentXml;
      const escaped = distinct.map((v) => escapeXml(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const runRegex = new RegExp(`<w:r\\b[^>]*>(?:(?!<\\/w:r>)[\\s\\S])*?<w:t\\b[^>]*>(?:${escaped.join("|")})<\\/w:t>(?:(?!<\\/w:r>)[\\s\\S])*?<\\/w:r>`, "g");
      return fragmentXml.replace(runRegex, (run) => forceRunFontSize(run, sz));
    }

    /* اسم المدرب بحجم 14 أينما وقع في المقطع (قد يشارك «مدرب المسار :» المقطع نفسه) */
    const TRAINER_FONT_HALF_POINTS = 28;
    function forceTrainerFontSize(fragmentXml, names) {
      const distinct = [...new Set(names)].filter(Boolean);
      if (distinct.length === 0) return fragmentXml;
      const escaped = distinct.map((v) => escapeXml(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const runRegex = new RegExp(`<w:r\\b[^>]*>(?:(?!<\\/w:r>)[\\s\\S])*?<w:t\\b[^>]*>[^<]*(?:${escaped.join("|")})[^<]*<\\/w:t>(?:(?!<\\/w:r>)[\\s\\S])*?<\\/w:r>`, "g");
      return fragmentXml.replace(runRegex, (run) => forceRunFontSize(run, TRAINER_FONT_HALF_POINTS));
    }

    /* نقاط بعد كل «التوقيع :» لا يتبعه شيء في فقرته، في مقطع مستقل بخط المقطع نفسه وبلا تسطير */
    const SIGN_DOTS = " ........................................";
    function addSignatureDots(fragmentXml) {
      return fragmentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
        const text = [...para.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
        if (!/التوقيع\s*:?\s*$/.test(text)) return para;
        const runs = [...para.matchAll(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g)];
        const last = runs.filter((r) => /<w:t\b/.test(r[0])).pop();
        if (!last) return para;
        const rPr = ((last[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0]).replace(/<w:(u|b|bCs)\b[^>]*\/>/g, ""); // النقاط بلا تسطير ولا عريض
        const dots = "<w:r>" + rPr + '<w:t xml:space="preserve">' + SIGN_DOTS + "</w:t></w:r>";
        const at = last.index + last[0].length;
        return para.slice(0, at) + dots + para.slice(at);
      });
    }

    // الأعمدة الرقمية وعمود «الدورة» في الوسط
    function isNumericColumn(header) {
      let sawValue = false;
      for (const row of dataRows) {
        const value = String(mappedValue(header, mapping, row) == null ? "" : mappedValue(header, mapping, row)).trim();
        if (!value) continue;
        sawValue = true;
        if (!/^-?\d+(\.\d+)?$/.test(value)) return false;
      }
      return sawValue;
    }
    /* تُوسَّط: أعمدة الأرقام، وأعمدة الهوية والجوال والتواريخ والساعات والتسلسل ولو كُتبت نصاً */
    const CENTER_HEADERS = /هوية|هويه|رقم|جوال|هاتف|تاريخ|ساعة|ساعه|وقت|الدورة|الدوره|المجموعة|المجموعه|التوقيع|^م$/;
    const centerColumns = templateHeaders.map((header) => !!header && (CENTER_HEADERS.test(normalizeHeader(header)) || isNumericColumn(header)));

    function forceCenterAlign(cellXml) {
      if (/<w:jc\b/.test(cellXml)) return cellXml.replace(/<w:jc\b[^>]*\/>/g, '<w:jc w:val="center"/>');
      return cellXml.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/g, (_m, inner) =>
        `<w:pPr>${insertOrdered(inner, '<w:jc w:val="center"/>', PPR_AFTER_JC)}</w:pPr>`);
    }

    // كل الأعمدة عدا الأعرض (غالباً الاسم) بلا التفاف
    let widestColumnIndex = 0;
    let widestWidth = -1;
    styleCells.forEach((cellXml, i) => {
      const width = Number((cellXml.match(/<w:tcW\b[^>]*w:w="(\d+)"/) || [])[1] || 0);
      if (width > widestWidth) { widestWidth = width; widestColumnIndex = i; }
    });

    const ensureNoWrap = (cellXml) => (/<w:noWrap\b/.test(cellXml) ? cellXml
      : cellXml.replace(/<w:tcPr>([\s\S]*?)<\/w:tcPr>/, (_m, inner) => `<w:tcPr>${insertOrdered(inner, "<w:noWrap/>", TCPR_AFTER_NOWRAP)}</w:tcPr>`));

    function normalizeCell(cellXml, columnIndex) {
      let normalized = forceFontSize(cellXml);
      if (columnIndex !== widestColumnIndex) normalized = ensureNoWrap(normalized);
      if (centerColumns[columnIndex]) normalized = forceCenterAlign(normalized);
      return normalized;
    }

    function normalizeRowFontSize(rowXml) {
      let columnIndex = 0;
      return rowXml.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, (cellXml) => normalizeCell(cellXml, columnIndex++));
    }

    function newRunRPr(cellXml) {
      const pPrRun = cellXml.match(/<w:pPr>[\s\S]*?<w:rPr>([\s\S]*?)<\/w:rPr>[\s\S]*?<\/w:pPr>/);
      if (pPrRun) return pPrRun[1];
      return `<w:sz w:val="${TEMPLATE_FONT_HALF_POINTS}"/><w:szCs w:val="${TEMPLATE_FONT_HALF_POINTS}"/><w:rtl/>`;
    }

    function buildRow(values, scale) {
      const cellsXml = styleCells.map((cellXml, i) => {
        const text = escapeXml(String(values[i] == null ? "" : values[i]));
        let replaced = false;
        const withValue = cellXml.replace(/<w:t([^>]*)>([^<]*)<\/w:t>/g, (_m, attrs) => {
          if (!replaced) { replaced = true; return `<w:t${attrs}>${text}</w:t>`; }
          return `<w:t${attrs}></w:t>`;
        });
        if (!replaced) {
          const run = `<w:r><w:rPr>${newRunRPr(cellXml)}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
          const lastParaClose = withValue.lastIndexOf("</w:p>");
          const injected = lastParaClose === -1
            ? withValue.replace(/<\/w:tc>$/, `<w:p>${run}</w:p></w:tc>`)
            : withValue.slice(0, lastParaClose) + run + withValue.slice(lastParaClose);
          return normalizeCell(injected, i);
        }
        return normalizeCell(withValue, i);
      });
      return scaleRowXml(`${rowOpenTag}${cellsXml.join("")}</w:tr>`, scale);
    }

    // تقليص تقريبي لتقريب المجموعة من صفحة واحدة
    const FIT_MIN_SCALE = 0.55;
    const FIT_MIN_FONT_HALF_POINTS = 16;
    const FIT_ASSUMED_LINE_HEIGHT_TWIPS = 320;

    function extractAttr(fromXml, tagName, attrName) {
      const tag = fromXml.match(new RegExp(`<${tagName}\\b[^>]*/?>`));
      if (!tag) return null;
      const attr = tag[0].match(new RegExp(`${attrName}="(-?\\d+)"`));
      return attr ? Number(attr[1]) : null;
    }

    function scaleRowXml(rowXml, scale) {
      if (scale >= 1) return rowXml;
      return rowXml
        .replace(/(<w:trHeight\b[^>]*w:val=")(\d+)(")/g, (_m, pre, val, post) => `${pre}${Math.round(Number(val) * scale)}${post}`)
        .replace(/(<w:sz(Cs)?\b[^>]*w:val=")(\d+)(")/g, (_m, pre, _cs, val, post) => `${pre}${Math.max(FIT_MIN_FONT_HALF_POINTS, Math.round(Number(val) * scale))}${post}`);
    }

    const countParagraphs = (fromXml) => (fromXml.match(/<w:p[ >]/g) || []).length;

    function computeGroupScale(rowCount) {
      if (!options.fitGroupToOnePage || rowCount === 0) return 1;
      const pageHeight = extractAttr(documentCloseXml, "w:pgSz", "w:h") || 15840;
      const marginTop = extractAttr(documentCloseXml, "w:pgMar", "w:top") || 1440;
      const marginBottom = extractAttr(documentCloseXml, "w:pgMar", "w:bottom") || 1440;
      const usableHeight = pageHeight - marginTop - marginBottom;
      const headerRowHeight = extractAttr(headerRowXml, "w:trHeight", "w:val") || 400;
      const dataRowHeight = extractAttr(styleRowXml, "w:trHeight", "w:val") || 400;
      const fixedOverhead = (countParagraphs(letterheadXml) + countParagraphs(repeatableTrailingXml)) * FIT_ASSUMED_LINE_HEIGHT_TWIPS + headerRowHeight;
      const maxFullSizeRows = Math.max(1, Math.floor((usableHeight - fixedOverhead) / dataRowHeight));
      if (rowCount <= maxFullSizeRows) return 1;
      return Math.max(FIT_MIN_SCALE, maxFullSizeRows / rowCount);
    }

    const groups = options.groupByColumns && options.groupByColumns.length ? groupRowsByColumns(dataRows, options.groupByColumns) : [dataRows];
    const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    const KEEP_ROWS = 3; // صفوف الجدول الأخيرة التي ترافق التوقيعات إلى الصفحة التالية

    /* صفوف البيانات بتباعد 1.3 بلا مسافة قبل الفقرة أو بعدها، فيأخذ الصف ارتفاع محتواه.
       يُكتب صريحاً في كل فقرة فيتقدّم على تباعد نمط القالب (مثل 1.5) */
    const SINGLE = '<w:spacing w:before="0" w:after="0" w:line="312" w:lineRule="auto"/>'; // 1.3 = 312 من 240
    // ما يأتي بعد spacing في ترتيب مخطط pPr
    const AFTER_SPACING = /<w:(ind|contextualSpacing|mirrorIndents|suppressOverlap|jc|textDirection|textAlignment|textboxTightWrap|outlineLvl|divId|cnfStyle|rPr|sectPr|pPrChange)\b/;
    function singleSpacing(fragmentXml) {
      return fragmentXml.replace(/<w:p(\s[^>]*)?>(\s*<w:pPr>([\s\S]*?)<\/w:pPr>)?/g, (full, attrs, _whole, inner) => {
        if (attrs && /\/\s*$/.test(attrs)) return full; // فقرة فارغة مغلقة ذاتياً
        const open = `<w:p${attrs || ""}>`;
        if (inner === undefined) return `${open}<w:pPr>${SINGLE}</w:pPr>`;
        let body = inner.replace(/<w:spacing\b[^>]*\/>/g, "");
        const at = body.search(AFTER_SPACING);
        body = at >= 0 ? body.slice(0, at) + SINGLE + body.slice(at) : body + SINGLE;
        return `${open}<w:pPr>${body}</w:pPr>`;
      });
    }

    /* «ابقَ مع التالي» لكل فقرة في المقطع: Word لا يفصلها عمّا بعدها،
       فلا تنتقل التوقيعات وحدها إلى صفحة فارغة بل تأخذ معها آخر صفوف الجدول */
    function keepWithNext(fragmentXml, skipLast) {
      const paras = [...fragmentXml.matchAll(/<w:p(\s[^>]*)?(\/>|>)/g)];
      const upto = skipLast ? paras.length - 1 : paras.length;
      let out = "";
      let pos = 0;
      for (let i = 0; i < upto; i++) {
        const m = paras[i];
        out += fragmentXml.slice(pos, m.index);
        const attrs = m[1] || "";
        if (m[2] === "/>") {
          out += `<w:p${attrs}><w:pPr><w:keepNext/></w:pPr></w:p>`;
          pos = m.index + m[0].length;
          continue;
        }
        out += m[0];
        pos = m.index + m[0].length;
        const rest = fragmentXml.slice(pos);
        const pPr = rest.match(/^\s*<w:pPr>([\s\S]*?)<\/w:pPr>/);
        if (pPr) {
          if (/<w:keepNext\b/.test(pPr[1])) continue;
          // الترتيب في المخطط: pStyle أولاً ثم keepNext
          const style = pPr[1].match(/^\s*<w:pStyle\b[^>]*\/>/);
          const inner = style ? style[0] + "<w:keepNext/>" + pPr[1].slice(style[0].length) : "<w:keepNext/>" + pPr[1];
          out += rest.slice(0, pPr.index) + "<w:pPr>" + inner + "</w:pPr>";
          pos += pPr.index + pPr[0].length;
        } else {
          out += "<w:pPr><w:keepNext/></w:pPr>";
        }
      }
      return out + fragmentXml.slice(pos);
    }

    const sections = groups.map((groupRows, index) => {
      if (options.sortRowsBy) sortRowsByColumn(groupRows, options.sortRowsBy);
      const scale = computeGroupScale(groupRows.length);
      let counter = 1;
      const rowXmls = groupRows
        .map((row) => buildRowValues(templateHeaders, mapping, row, options.autoNumberHeader, counter++))
        .map((values) => singleSpacing(buildRow(values, scale)));
      const hasTrailing = /<w:t[ >]/.test(repeatableTrailingXml);
      const generatedRows = rowXmls.map((x, i) => (hasTrailing && i >= rowXmls.length - KEEP_ROWS ? keepWithNext(x, false) : x)).join("");
      const groupPlaceholderValues = rowsToPlaceholderValueLists(groupRows);
      const sectionLetterhead = substitutePlaceholders(letterheadXml, groupPlaceholderValues);
      const sectionTable = `${tableOpenPart}${scaleRowXml(normalizeRowFontSize(headerRowXml), scale)}${generatedRows}</w:tbl>`;
      const multiValueTexts = Object.values(groupPlaceholderValues).filter((list) => list.length > 1).flat();
      // أسماء مدرّبي هذا المسار من صفحة المسارات
      const trainerNames = [TRAINER_COLS.t1, TRAINER_COLS.t2].flatMap((c) => groupPlaceholderValues[c] || []);
      const sectionTrailing = keepWithNext(addSignatureDots(forceTrainerFontSize(forceFontSizeForValues(substitutePlaceholders(repeatableTrailingXml, groupPlaceholderValues), multiValueTexts, TEMPLATE_FONT_HALF_POINTS), trainerNames)), true);
      return `${index > 0 ? PAGE_BREAK : ""}${sectionLetterhead}${sectionTable}${sectionTrailing}`;
    }).join("");

    zip.file(documentPath, `${documentOpenXml}${sections}${documentCloseXml}`);
    return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  /* ===== نقطة التوليد: نفس منطق مسار convert-template ===== */
  async function generate({ templateBuffer, templateIsDocx, templateName, templateHeaders, mapping, dataRows, outputFormat, groupByColumns, autoNumberHeader, sortRowsBy, fitGroupToOnePage, sessionDates, textFields }) {
    let outputName = templateName || "converted";
    if (sessionDates) outputName = `${outputName} - ${formatMonthYearArabic(sessionDates.startDate)}`;
    const sameFormat = templateBuffer != null && (outputFormat === "docx") === templateIsDocx;
    const groups = groupByColumns && groupByColumns.length ? groupByColumns : undefined;

    let blob;
    if (outputFormat === "docx") {
      blob = sameFormat
        ? await fillDocxTemplate(templateBuffer, templateHeaders, mapping, dataRows, { groupByColumns: groups, autoNumberHeader, fitGroupToOnePage, textFields, sortRowsBy })
        : await buildBareDocx(templateHeaders, mapping, dataRows);
    } else {
      blob = sameFormat
        ? await fillXlsxTemplate(templateBuffer, templateHeaders, mapping, dataRows, { groupByColumns: groups, autoNumberHeader, sortRowsBy, sessionDates, fitGroupToOnePage })
        : await buildBareXlsx(templateHeaders, mapping, dataRows);
    }
    return { blob, filename: `${outputName}.${outputFormat}` };
  }

  App.converterCore = {
    MAX_ROWS, normalizeHeader, suggestColumnMapping, resolveDefaultColumn, computeGroupKey,
    isDocxName, readTemplateHeaders, readTemplatePlaceholders, readDataFile, mergeDataFiles, guessKey, generate,
    gradeOf, addComputedGrade, preferComputedGrade, guessAverageColumn, GRADE_COLUMN,
    addTrainerColumns, preferTrainers, trainerColumnFor, guessTrackColumn, TRAINER_COLS, sortRowsByColumn,
    addAgeColumn, preferAge, guessBirthColumn, ageFrom, AGE_COLUMN,
    readTemplateTextFields,
    // للاختبار
    computeSessionDates, fillXlsxTemplate, fillDocxTemplate, extractHeadersFromDocxTable,
  };
})(window.App = window.App || {});
