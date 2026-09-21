-- سجل التعديلات: يُلصق في Supabase ← SQL Editor ← New query ← Run (مرة واحدة، آمن للتكرار)

-- ===== سجل التعديلات: القيمة قبل كل تعديل وبعده (للتراجع) — يُحتفظ به 180 يوماً =====
create table if not exists revisions (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  col     text not null,
  rec_id  text not null,
  who     text not null default '',
  action  text not null default '',   -- add | edit | delete | revert
  before  jsonb,
  after   jsonb,
  ref     bigint                       -- التعديل الذي تراجع عنه
);
create index if not exists revisions_rec_idx on revisions (col, rec_id);
create index if not exists revisions_who_idx on revisions (who);
create index if not exists revisions_at_idx on revisions (at);
alter table revisions enable row level security;
