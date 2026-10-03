# Graph Report - Tamkeen  (2026-10-01)

## Corpus Check
- 59 files · ~163,515 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1934 nodes · 4854 edges · 88 communities (67 shown, 14 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 309 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `18475795`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- exceljs.min.js
- converter-core.js
- registry.js
- index.ts
- a
- converter.js
- fail
- M
- re
- d
- i
- watch-folder.mjs
- l
- C
- forEach
- n
- getCell
- $
- B
- profile.js
- screen.js
- s
- A
- letters.js
- _applyStyle
- k
- roster.js
- o
- jszip.min.js
- run.mjs
- hospitality.js
- r
- admin.js
- report.js
- sheets.js
- o
- ksach-stats.js
- parse
- decodeEx
- shared.js
- التركيب (نحو 15 دقيقة)
- cloud.js
- drive.js
- tracks.js
- ai.js
- converter-store.js
- meetings.js
- p
- setup.ps1
- j
- مراقب المجلدات — مساعد تمكين الإداري
- docx.js
- drive-ui.js
- history.js
- storage.js
- مساعد تمكين الإداري
- .parse
- roster-audit.js
- reconcile
- doc-render.js
- build_letterhead.py
- captureToChar
- build-bat.mjs
- search.js
- tasks.js
- qrcode.min.js
- app.js
- rtl-fixer.js
- rtl-page.js
- templates.js
- create
- files-store.js
- transform
- h
- ai-assist.js
- dashboard.js
- _assign
- charts.js
- sw.js
- escapeHtml
- .names

## God Nodes (most connected - your core abstractions)
1. `a` - 93 edges
2. `l` - 84 edges
3. `s()` - 76 edges
4. `o` - 72 edges
5. `i()` - 66 edges
6. `M` - 63 edges
7. `k()` - 62 edges
8. `r()` - 61 edges
9. `o()` - 60 edges
10. `forEach()` - 58 edges

## Surprising Connections (you probably didn't know these)
- `init()` --indirect_call--> `close()`  [INFERRED]
  src/profile.js → vendor/exceljs.min.js
- `init()` --indirect_call--> `close()`  [INFERRED]
  src/drive-ui.js → vendor/exceljs.min.js
- `init()` --indirect_call--> `close()`  [INFERRED]
  src/notify.js → vendor/exceljs.min.js
- `pick()` --indirect_call--> `keyOf()`  [INFERRED]
  src/watch.js → watcher/watch-folder.mjs
- `parseText()` --indirect_call--> `e()`  [INFERRED]
  vendor/exceljs.min.js → vendor/qrcode.min.js

## Import Cycles
- None detected.

## Communities (88 total, 14 thin omitted)

### Community 0 - "exceljs.min.js"
Cohesion: 0.02
Nodes (38): addBackgroundImage(), addImage(), addRichText(), addStringBuf(), addStyleModel(), addTable(), addText(), addWorksheet() (+30 more)

### Community 1 - "converter-core.js"
Cohesion: 0.06
Nodes (77): addAgeColumn(), addComputedGrade(), addShiftedImages(), addTrainerColumns(), ageFrom(), applyDatesToRow(), applyTemplateTextFields(), buildBareDocx() (+69 more)

### Community 2 - "registry.js"
Cohesion: 0.08
Nodes (65): actionsHtml(), addBulkFiles(), archiveList(), archiveNow(), archiveRecord(), assignNumbers(), attachFile(), autoArchive() (+57 more)

### Community 3 - "index.ts"
Cohesion: 0.07
Nodes (50): adopt(), b64(), backupDaily(), changePassword(), checkPassword(), chunk(), db, deleteUser() (+42 more)

### Community 4 - "a"
Cohesion: 0.06
Nodes (7): a, i(), excelToDate(), mergeCells(), normalizeModel(), parseClose(), e()

### Community 5 - "converter.js"
Cohesion: 0.08
Nodes (55): ageControl(), applyFixed(), applyProfile(), currentTrackName(), deleteProfile(), distinctGroups(), downloadMerged(), exportControl() (+47 more)

### Community 6 - "fail"
Cohesion: 0.07
Nodes (51): captureNameChars(), captureTo(), closeTag(), fail(), getCode10(), getCode11(), getCodeNorm(), handleTextInRoot() (+43 more)

### Community 7 - "M"
Cohesion: 0.09
Nodes (15): end(), _getWritableBuffer(), _init(), M, on(), parseStream(), _pipe(), read() (+7 more)

### Community 9 - "d"
Cohesion: 0.11
Nodes (11): d, getAnchorRect(), getDefaultRect(), horizontal(), isInternalLink(), readingOrder(), render(), n() (+3 more)

### Community 10 - "i"
Cohesion: 0.06
Nodes (8): add(), convertPasswordToHash(), deepMerge(), dimensions(), i(), prepare(), processAttribsNS(), protect()

### Community 11 - "watch-folder.mjs"
Cohesion: 0.11
Nodes (38): init(), pick(), render(), scan(), start(), stop(), walk(), ask() (+30 more)

### Community 13 - "C"
Cohesion: 0.10
Nodes (11): C, n(), s(), E, F(), L, O, R (+3 more)

### Community 14 - "forEach"
Cohesion: 0.11
Nodes (5): c, columns(), forEach(), isExt(), map()

### Community 16 - "getCell"
Cohesion: 0.08
Nodes (36): actualCellCount(), actualColumnCount(), actualRowCount(), addColumn(), addRow(), addRows(), cacheState(), columnCount() (+28 more)

### Community 17 - "$"
Cohesion: 0.06
Nodes (13): $, delete(), G(), _handleTokenChanged(), _initRealtimeClient(), _initSupabaseAuthClient(), insert(), _listenForAuthEvents() (+5 more)

### Community 18 - "B"
Cohesion: 0.13
Nodes (6): B(), i(), S(), T, v(), y

### Community 19 - "profile.js"
Cohesion: 0.13
Nodes (29): applyAccess(), changePassword(), clearSharedCache(), forgot(), fullBackup(), hideLogin(), hideReset(), init() (+21 more)

### Community 20 - "screen.js"
Cohesion: 0.15
Nodes (30): bars(), choices(), copyKey(), exportNames(), fullReport(), fullscreen(), groupPhases(), hide() (+22 more)

### Community 21 - "s"
Cohesion: 0.08
Nodes (6): createNewModel(), i(), j, parseOpen(), s(), toModel()

### Community 23 - "letters.js"
Cohesion: 0.14
Nodes (39): aiGenerate(), aiStatus(), allTemplates(), approvalClick(), blocks(), cancelReply(), captureFields(), clearApprovalPreview() (+31 more)

### Community 24 - "_applyStyle"
Cohesion: 0.17
Nodes (6): alignment(), _applyStyle(), border(), font(), numFmt(), protection()

### Community 25 - "k"
Cohesion: 0.11
Nodes (3): k(), P(), z()

### Community 26 - "roster.js"
Cohesion: 0.19
Nodes (26): addColumn(), addNote(), addRecord(), applyImport(), checkColumns(), columnMeta(), compare(), exportExcel() (+18 more)

### Community 28 - "jszip.min.js"
Cohesion: 0.24
Nodes (23): A(), c(), d(), i(), n(), f(), G(), h() (+15 more)

### Community 29 - "run.mjs"
Cohesion: 0.09
Nodes (14): makeDb(), NOT_NULL, PK, as, back, blob15, code, delAt (+6 more)

### Community 30 - "hospitality.js"
Cohesion: 0.24
Nodes (23): addMonthSheet(), applyRows(), asBoxes(), dayTotal(), defaultDay(), exportXlsx(), init(), monthTotals() (+15 more)

### Community 31 - "r"
Cohesion: 0.13
Nodes (40): ae(), b(), ce(), _copyModel(), n(), o(), E(), Ee() (+32 more)

### Community 32 - "admin.js"
Cohesion: 0.23
Nodes (20): adoptDevice(), copyLegacy(), exportUsers(), importUsers(), init(), load(), moveLog(), openForm() (+12 more)

### Community 33 - "report.js"
Cohesion: 0.22
Nodes (23): addAiFiles(), addModel(), blocks(), chartImages(), comparisonRows(), compute(), defaultPeriod(), deleteModel() (+15 more)

### Community 34 - "sheets.js"
Cohesion: 0.29
Nodes (17): addRow(), addSheet(), cellHtml(), deleteColumn(), deleteRow(), deleteSheet(), exportExcel(), guessType() (+9 more)

### Community 35 - "o"
Cohesion: 0.14
Nodes (18): constructor(), _explore(), a(), l(), f(), fill(), findCellAt(), getCellEx() (+10 more)

### Community 36 - "ksach-stats.js"
Cohesion: 0.40
Nodes (16): decompose(), eachPage(), firstNum(), getDoc(), groupAndTrainer(), headOf(), push(), readFollowUps() (+8 more)

### Community 37 - "parse"
Cohesion: 0.19
Nodes (16): advancePastLine(), advancePastToken(), advanceTo(), advanceToToken(), checkForMalformedColumn(), gatherDataBetweenQuotes(), getStartToken(), isTokenCarriageReturn() (+8 more)

### Community 38 - "decodeEx"
Cohesion: 0.08
Nodes (22): addCell(), addCellEx(), addEx(), decodeEx(), findCell(), findCellEx(), findRowCell(), findSheet() (+14 more)

### Community 39 - "shared.js"
Cohesion: 0.29
Nodes (12): collect(), editingIn(), fingerprint(), firstSync(), init(), keepOrder(), loadPeople(), readCol() (+4 more)

### Community 40 - "التركيب (نحو 15 دقيقة)"
Cohesion: 0.14
Nodes (13): 1. أنشئ مشروعاً على Supabase, 2. أنشئ الجداول, 3. انشر الدالة الطرفية, 4. ضَع رمز المدير, 5. انسخ رابط الدالة, 6. حوّل جهازك إليه, 7. انقل البيانات (اختياري), الاختبار (+5 more)

### Community 41 - "cloud.js"
Cohesion: 0.40
Nodes (13): applyOverride(), banner(), call(), download(), expire(), logout(), moveToDefault(), refreshUser() (+5 more)

### Community 42 - "drive.js"
Cohesion: 0.36
Nodes (13): addUsers(), api(), connect(), disconnect(), ensurePath(), folderId(), loadGis(), markInGoogle() (+5 more)

### Community 43 - "tracks.js"
Cohesion: 0.35
Nodes (13): addTrack(), applyList(), dedupe(), init(), onInput(), openList(), ordered(), removeTrack() (+5 more)

### Community 44 - "ai.js"
Cohesion: 0.28
Nodes (10): claudeError(), geminiError(), geminiModels(), generate(), generateClaude(), generateGemini(), loadSettings(), post() (+2 more)

### Community 45 - "converter-store.js"
Cohesion: 0.36
Nodes (11): db(), get(), reconcile(), remove(), reshare(), run(), save(), setDefaultGroupBy() (+3 more)

### Community 46 - "meetings.js"
Cohesion: 0.37
Nodes (10): blocks(), formValues(), init(), load(), remove(), renderDecisions(), renderList(), renderPreview() (+2 more)

### Community 48 - "setup.ps1"
Cohesion: 0.47
Nodes (9): Ask-Choice(), Ask-Choice3(), Ask-Folders(), Ask-Login(), Ask-Text(), New-Btn(), New-Dialog(), New-Label() (+1 more)

### Community 50 - "مراقب المجلدات — مساعد تمكين الإداري"
Cohesion: 0.18
Nodes (10): مراقب المجلدات — مساعد تمكين الإداري, ١) الطريقة السهلة: ملف باتش واحد يفعل كل شيء, ٢) الطريقة اليدوية (إن أردت ضبط الإعدادات بنفسك), ٣) الرفع المباشر إلى Google Drive, ٤) التشغيل التلقائي مع ويندوز (إن لم تختره في التجهيز), ٥) أوامر مفيدة, ٦) ماذا يكتب في القيد؟, ٧) ملفات لا تُرفع (+2 more)

### Community 51 - "docx.js"
Cohesion: 0.38
Nodes (9): addressee(), base64ToBytes(), build(), crc32(), dataUrlToBytes(), image(), paragraph(), table() (+1 more)

### Community 52 - "drive-ui.js"
Cohesion: 0.23
Nodes (18): addUsersFromInput(), ensureConnected(), init(), open(), openGoogleUsers(), persist(), renderStatus(), renderUsers() (+10 more)

### Community 53 - "history.js"
Cohesion: 0.49
Nodes (9): changes(), init(), load(), paint(), render(), revert(), rowHtml(), titleOf() (+1 more)

### Community 54 - "storage.js"
Cohesion: 0.38
Nodes (8): defaultState(), defaultTracks(), importJSON(), load(), reloadIfChanged(), reset(), save(), uid()

### Community 55 - "مساعد تمكين الإداري"
Cohesion: 0.22
Nodes (8): أرشيف المركز المشترك (الموصى به), الأرشفة على Google Drive, التشغيل, الحسابات والصلاحيات, الوحدات, ما يُشارَك بين الأجهزة, مساعد تمكين الإداري, ملاحظات

### Community 57 - "roster-audit.js"
Cohesion: 0.44
Nodes (8): audit(), beforeExport(), columns(), init(), render(), section(), validId(), validPhone()

### Community 58 - "reconcile"
Cohesion: 0.16
Nodes (10): decode(), decodeAddress(), encode(), fillFormula(), getString(), getStyleModel(), isDateFmt(), reconcile() (+2 more)

### Community 60 - "doc-render.js"
Cohesion: 0.43
Nodes (6): blockEl(), newPage(), paginate(), print(), rowEl(), tableEl()

### Community 61 - "build_letterhead.py"
Cohesion: 0.39
Nodes (7): blank_letterhead_pdf(), build_docx_parts(), main(), optimize_media(), تجهيز الترويسة الرسمية من ملف Word الأصلي. المخرجات: assets/letterhead/page.jpg…, نسخة من الترويسة بمتن فارغ، محوّلة إلى PDF عبر Word., render_page()

### Community 62 - "captureToChar"
Cohesion: 0.25
Nodes (8): captureToChar(), sCData(), sComment(), sDoctypeQuote(), sDTDComment(), sDTDPI(), sDTDQuoted(), sPIBody()

### Community 63 - "build-bat.mjs"
Cohesion: 0.25
Nodes (7): header, HERE, js, lines, OUT, ps1, ui

### Community 64 - "search.js"
Cohesion: 0.57
Nodes (6): index(), init(), move(), open(), pick(), run()

### Community 65 - "tasks.js"
Cohesion: 0.48
Nodes (5): init(), itemHTML(), meetingLabel(), render(), visible()

### Community 66 - "qrcode.min.js"
Cohesion: 0.43
Nodes (5): C(), d(), i(), a(), p()

### Community 67 - "app.js"
Cohesion: 0.47
Nodes (4): applyTheme(), initBackup(), initTheme(), show()

### Community 68 - "rtl-fixer.js"
Cohesion: 0.60
Nodes (5): ensureFlag(), fixDocx(), fixJc(), fixXml(), insertOrdered()

### Community 69 - "rtl-page.js"
Cohesion: 0.73
Nodes (5): archive(), downloadAll(), handleFiles(), init(), render()

### Community 70 - "templates.js"
Cohesion: 0.47
Nodes (3): addresseeLayout(), signatureLayout(), textWidthPt()

### Community 72 - "files-store.js"
Cohesion: 0.60
Nodes (3): db(), put(), tx()

### Community 75 - "transform"
Cohesion: 0.40
Nodes (5): mapHeaders(), processRow(), setHeaders(), shouldMapRow(), transform()

### Community 77 - "ai-assist.js"
Cohesion: 0.83
Nodes (3): attach(), polish(), showUndo()

### Community 78 - "dashboard.js"
Cohesion: 0.83
Nodes (3): bars(), charts(), render()

### Community 79 - "_assign"
Cohesion: 0.50
Nodes (4): _assign(), headerRow(), ref(), totalsRow()

## Knowledge Gaps
- **58 isolated node(s):** `db`, `enc`, `FIELD_MERGE`, `PK`, `NOT_NULL` (+53 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 416 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `$` connect `$` to `re`, `h`, `C`, `p`, `n`, `j`, `B`, `A`, `k`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Why does `m()` connect `p` to `o`, `a`, `C`, `forEach`, `$`, `B`, `o`, `jszip.min.js`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Why does `close()` connect `drive-ui.js` to `exceljs.min.js`, `profile.js`, `M`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `s()` (e.g. with `t()` and `h()`) actually correct?**
  _`s()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `o` (e.g. with `l()` and `f()`) actually correct?**
  _`o` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `i()` (e.g. with `b()` and `f()`) actually correct?**
  _`i()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `db`, `enc`, `FIELD_MERGE` to the rest of the system?**
  _58 weakly-connected nodes found - possible documentation gaps or missing edges._