#!/usr/bin/env bash
# نشر تمكين على Vercel عبر فرع main في مستودع tamkeen-admin.
#
#   bash Tamkeen/tools/deploy.sh [رقم نسخة center-cmd المتوقع بعد النشر]
#
# ما يفعله (وهو ما كنا نكتبه يدوياً):
#   1) يقسّم مجلد Tamkeen من الفرع الحالي (git subtree split).
#   2) يجلب main البعيد ويدمج الانقسام فوقه — لا force أبداً، فلا يُمحى ما دفعته جلسة أخرى.
#   3) يدفع إلى main مع إعادة المحاولة عند انقطاع الشبكة.
#   4) ينتظر ظهور الرقم المتوقع في الموقع الحي ويتحقق منه.
#
# لا يعدّل ملفاتك: يعمل في worktree مؤقت. يحتاج remote اسمه tamkeen.
set -u
EXPECT="${1:-}"
LIVE="https://tamkeen-admin.vercel.app/"
ROOT="$(git rev-parse --show-toplevel)" || exit 1
cd "$ROOT" || exit 1
git remote get-url tamkeen >/dev/null 2>&1 || { echo "لا يوجد remote باسم tamkeen"; exit 1; }
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
WT="${TMPDIR:-/tmp}/tamkeen-deploy-wt"

retry() { for t in 1 2 3 4 5 6; do "$@" && return 0; echo "إعادة المحاولة $t: $*"; sleep 8; done; return 1; }

git worktree remove --force "$WT" 2>/dev/null; git worktree prune

echo "تقسيم مجلد Tamkeen من $BRANCH …"
SPLIT="$(git subtree split --prefix=Tamkeen "$BRANCH" 2>/dev/null | tail -1)"
[ -n "$SPLIT" ] || { echo "فشل التقسيم"; exit 1; }

echo "جلب main البعيد …"
retry git fetch -q tamkeen main || { echo "تعذّر الجلب (شبكة؟)"; exit 1; }
git worktree add -q --detach "$WT" FETCH_HEAD || exit 1
( cd "$WT" && git merge -q --no-edit "$SPLIT" ) || { echo "تعارض في الدمج: حلّه يدوياً في $WT"; exit 1; }

echo "دفع إلى main …"
( cd "$WT" && retry git push tamkeen HEAD:main ) || { echo "تعذّر الدفع"; exit 1; }
git worktree remove --force "$WT" 2>/dev/null

if [ -n "$EXPECT" ]; then
  echo "انتظار ظهور center-cmd.js?v=$EXPECT في الموقع …"
  for i in 1 2 3 4 5 6 7 8 9 10; do
    v="$(curl -s -m 15 "$LIVE" | grep -o 'center-cmd.js?v=[0-9]*')"
    echo "  [$i] $v"
    [ "$v" = "center-cmd.js?v=$EXPECT" ] && { echo "تم: الموقع على $EXPECT"; exit 0; }
    sleep 15
  done
  echo "تحذير: الدفع تم لكن الموقع لم يعرض $EXPECT بعد؛ قد يستغرق بناء Vercel وقتاً."
  exit 2
fi
echo "تم الدفع."
