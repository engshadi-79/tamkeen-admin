-- قاعدة بيانات مساعد تمكين على Supabase (Postgres) — النسخة التجريبية
-- تُلصق كاملة في: Supabase ← SQL Editor ← New query ← Run
-- آمنة للتكرار: تشغيلها مرتين لا يُفسد شيئاً.

-- مطلوبة لفهارس البحث النصي بالتشابه
create extension if not exists pg_trgm;

-- ===== الحسابات =====
create table if not exists app_users (
  username   text primary key,
  name       text not null,
  email      text not null default '',
  admin      boolean not null default false,
  active     boolean not null default true,
  salt       text not null,
  hash       text not null,
  algo       text not null default 'pbkdf2',   -- pbkdf2 للحسابات الجديدة، gas300 للمنقولة من Apps Script
  views      jsonb not null default '[]'::jsonb,  -- الصفحات المسموح بها (فارغ = الكل)
  perms      jsonb not null default '{}'::jsonb,  -- صلاحيات مثل الحذف والرفع والتصدير
  last_login timestamptz
);

create table if not exists sessions (
  token      text primary key,
  username   text not null references app_users(username) on delete cascade,
  expires_at timestamptz not null
);
create index if not exists sessions_expires_idx on sessions (expires_at);
create index if not exists sessions_user_idx on sessions (username);

create table if not exists resets (
  username   text primary key references app_users(username) on delete cascade,
  code       text not null,
  expires_at timestamptz not null
);

-- ===== السجلات: صفّ لكل قيد، لا ملف JSON واحد =====
-- col = اسم القسم: registry للوارد والصادر، وtracks وtasks وmeetings وroster وsettings…
create table if not exists records (
  col        text not null,
  id         text not null,
  owner      text not null default '',
  stamp      text not null default '',   -- updatedAt كما ترسله الأداة (ISO)، تُقارَن نصياً كما في الخادم القديم
  data       jsonb not null,
  search     text not null default '',   -- نص مسطّح للبحث السريع
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
create index if not exists records_col_idx on records (col);
create index if not exists records_owner_idx on records (col, owner);
create index if not exists records_search_idx on records using gin (search gin_trgm_ops);

-- ===== المحذوفات: شواهد قبور تمنع عودة المحذوف من جهاز قديم =====
create table if not exists deletions (
  col text not null,
  id  text not null,
  at  text not null,            -- وقت الحذف كما أرسله الجهاز
  primary key (col, id)
);

-- ===== سجل أحداث النظام =====
create table if not exists events (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  who     text not null default '',
  action  text not null default '',
  details text not null default ''
);
create index if not exists events_at_idx on events (at desc);

-- ===== عدّادات أرقام الصادر =====
create table if not exists counters (
  head  text primary key,
  value integer not null default 0
);

-- ===== إعدادات الخادم (الملخص اليومي، تاريخ آخر نسخة احتياطية…) =====
create table if not exists kv (
  key   text primary key,
  value jsonb not null
);

-- ===== الملفات المرفوعة (البيانات الوصفية؛ الملف نفسه في Storage) =====
create table if not exists files (
  id         text primary key,          -- مسار الملف داخل حاوية التخزين
  name       text not null,
  mime       text not null default 'application/octet-stream',
  size       bigint not null default 0,
  folder     text not null default '',  -- المسار المقروء: أحمد/2026/09/الوارد/خطابات
  owner      text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists files_name_idx on files using gin (name gin_trgm_ops);

-- ===== الإغلاق: لا أحد يصل إلى الجداول إلا الدالة الطرفية بمفتاح الخدمة =====
alter table app_users enable row level security;
alter table sessions  enable row level security;
alter table resets    enable row level security;
alter table records   enable row level security;
alter table deletions enable row level security;
alter table events    enable row level security;
alter table counters  enable row level security;
alter table kv        enable row level security;
alter table files     enable row level security;
-- بلا أي policy: المفتاح العام (anon) لا يقرأ ولا يكتب شيئاً إطلاقاً.

-- ===== حاويتا التخزين: المرفقات والنسخ الاحتياطية (خاصّتان) =====
insert into storage.buckets (id, name, public)
values ('tamkeen', 'tamkeen', false), ('tamkeen-backups', 'tamkeen-backups', false)
on conflict (id) do nothing;

-- ===== حجز أرقام الصادر: عدّاد ذرّي، لا يأخذ جهازان الرقم نفسه =====
create or replace function reserve_numbers(p_head text, p_count int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max int;
  v_rec int;
begin
  insert into counters (head, value) values (p_head, 0) on conflict (head) do nothing;
  -- قفل على صفّ العدّاد وحده، لا على قاعدة البيانات
  select value into v_max from counters where head = p_head for update;

  -- أعلى رقم مستعمل فعلاً في سجل الوارد والصادر، تحسّباً لأرقام أُدخلت يدوياً
  select coalesce(max((substring(substring(data ->> 'number' from char_length(p_head) + 1) from '^\d{1,9}'))::int), 0)
    into v_rec
  from records
  where col = 'registry'
    and left(data ->> 'number', char_length(p_head)) = p_head;

  v_max := greatest(coalesce(v_max, 0), coalesce(v_rec, 0));
  update counters set value = v_max + p_count where head = p_head;
  return v_max + p_count;
end;
$$;
