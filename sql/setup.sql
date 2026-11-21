-- =====================================================================
-- KAS KEGIATAN - setup database
-- Jalankan SEKALI di Supabase > SQL Editor (paste semua, tekan Run)
-- Aman dijalankan ulang (pakai "if not exists" / "drop ... if exists").
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. TABEL
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nama text,
  role text not null default 'viewer' check (role in ('bendahara','viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  nama text not null check (length(trim(nama)) > 0),
  deskripsi text,
  tanggal_mulai date,
  tanggal_selesai date,
  status text not null default 'aktif' check (status in ('aktif','arsip')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (tanggal_mulai is null or tanggal_selesai is null or tanggal_selesai >= tanggal_mulai)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  jenis text not null check (jenis in ('masuk','keluar')),
  tanggal date not null,
  nama_penyetor text,          -- wajib untuk pemasukan
  kategori text,               -- pemasukan: asal (guru/donatur/sponsor/...), pengeluaran: kategori
  keterangan text,
  total numeric(16,2) not null check (total >= 0),
  mode text check (mode in ('A','B')),  -- hanya pengeluaran: A banyak barang, B satu barang
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint masuk_valid check (
    jenis <> 'masuk' or (nama_penyetor is not null and length(trim(nama_penyetor)) > 0 and total > 0)
  ),
  constraint keluar_valid check (jenis <> 'keluar' or mode is not null)
);

create table if not exists public.expense_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  urutan int not null default 1,
  nama_barang text not null check (length(trim(nama_barang)) > 0),
  sub_barang text,
  qty numeric(14,3) not null check (qty > 0),
  satuan text not null check (length(trim(satuan)) > 0),
  harga_satuan numeric(16,2) check (harga_satuan is null or harga_satuan >= 0),
  total_harga numeric(16,2) not null check (total_harga >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  file_path text not null unique,
  is_public boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data jsonb,
  new_data jsonb,
  user_id uuid,
  user_email text,
  created_at timestamptz not null default now()
);

create index if not exists idx_tx_event_tanggal on public.transactions (event_id, tanggal desc);
create index if not exists idx_items_tx on public.expense_items (transaction_id);
create index if not exists idx_receipts_tx on public.receipts (transaction_id);
create index if not exists idx_audit_created on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------------
-- 2. FUNGSI & TRIGGER
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Cek apakah user yang login adalah bendahara
create or replace function public.is_bendahara()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'bendahara'
  );
$$;

-- Audit log otomatis
create or replace function public.log_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text := auth.jwt() ->> 'email';
begin
  if tg_op = 'DELETE' then
    insert into public.audit_logs (table_name, record_id, action, old_data, user_id, user_email)
    values (tg_table_name, old.id, 'DELETE', to_jsonb(old), auth.uid(), v_email);
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_logs (table_name, record_id, action, old_data, new_data, user_id, user_email)
    values (tg_table_name, new.id, 'UPDATE', to_jsonb(old), to_jsonb(new), auth.uid(), v_email);
    return new;
  else
    insert into public.audit_logs (table_name, record_id, action, new_data, user_id, user_email)
    values (tg_table_name, new.id, 'INSERT', to_jsonb(new), auth.uid(), v_email);
    return new;
  end if;
end $$;

-- Transaksi pada kegiatan yang diarsipkan tidak boleh diubah
create or replace function public.guard_archived_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_event uuid := coalesce(new.event_id, old.event_id);
begin
  select status into v_status from public.events where id = v_event;
  if v_status = 'arsip' then
    raise exception 'Kegiatan ini sudah diarsipkan. Aktifkan lagi kalau mau mengubah data.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- updated_at
drop trigger if exists trg_upd_profiles on public.profiles;
create trigger trg_upd_profiles before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists trg_upd_events on public.events;
create trigger trg_upd_events before update on public.events for each row execute function public.set_updated_at();
drop trigger if exists trg_upd_transactions on public.transactions;
create trigger trg_upd_transactions before update on public.transactions for each row execute function public.set_updated_at();
drop trigger if exists trg_upd_items on public.expense_items;
create trigger trg_upd_items before update on public.expense_items for each row execute function public.set_updated_at();
drop trigger if exists trg_upd_receipts on public.receipts;
create trigger trg_upd_receipts before update on public.receipts for each row execute function public.set_updated_at();

-- guard arsip
drop trigger if exists trg_guard_transactions on public.transactions;
create trigger trg_guard_transactions before insert or update or delete on public.transactions
  for each row execute function public.guard_archived_event();

-- audit
drop trigger if exists trg_audit_transactions on public.transactions;
create trigger trg_audit_transactions after insert or update or delete on public.transactions
  for each row execute function public.log_audit();
drop trigger if exists trg_audit_events on public.events;
create trigger trg_audit_events after insert or update or delete on public.events
  for each row execute function public.log_audit();
drop trigger if exists trg_audit_receipts on public.receipts;
create trigger trg_audit_receipts after insert or update or delete on public.receipts
  for each row execute function public.log_audit();

-- ---------------------------------------------------------------------
-- 3. RPC PENGELUARAN (atomik: transaksi + barang disimpan sekaligus,
--    total dihitung & divalidasi di server)
-- ---------------------------------------------------------------------
create or replace function public._expense_item_total(p_item jsonb)
returns numeric language plpgsql immutable as $$
declare
  v_qty numeric := nullif(p_item ->> 'qty', '')::numeric;
  v_harga numeric := nullif(p_item ->> 'harga_satuan', '')::numeric;
  v_total numeric := nullif(p_item ->> 'total_harga', '')::numeric;
begin
  if coalesce(trim(p_item ->> 'nama_barang'), '') = '' then
    raise exception 'Nama barang wajib diisi';
  end if;
  if coalesce(trim(p_item ->> 'satuan'), '') = '' then
    raise exception 'Satuan wajib diisi';
  end if;
  if v_qty is null or v_qty <= 0 then
    raise exception 'Qty harus lebih dari 0';
  end if;
  if v_harga is not null then
    if v_harga < 0 then raise exception 'Harga satuan tidak boleh negatif'; end if;
    return round(v_qty * v_harga, 2);
  end if;
  if v_total is null or v_total < 0 then
    raise exception 'Total harga wajib diisi dan tidak boleh negatif';
  end if;
  return round(v_total, 2);
end $$;

create or replace function public.save_expense(
  p_transaction_id uuid,
  p_event_id uuid,
  p_tanggal date,
  p_kategori text,
  p_keterangan text,
  p_mode text,
  p_items jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_item jsonb;
  v_sum numeric := 0;
  v_n int := 0;
begin
  if not public.is_bendahara() then
    raise exception 'Hanya bendahara yang boleh mencatat pengeluaran';
  end if;
  if p_tanggal is null then raise exception 'Tanggal wajib diisi'; end if;
  if p_mode is null or p_mode not in ('A','B') then raise exception 'Mode tidak valid'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Minimal satu barang';
  end if;
  if p_mode = 'B' and jsonb_array_length(p_items) <> 1 then
    raise exception 'Mode satu barang hanya boleh berisi 1 barang';
  end if;

  -- validasi + hitung total di server
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_sum := v_sum + public._expense_item_total(v_item);
  end loop;

  if p_transaction_id is null then
    if not exists (select 1 from public.events where id = p_event_id) then
      raise exception 'Kegiatan tidak ditemukan';
    end if;
    insert into public.transactions (event_id, jenis, tanggal, kategori, keterangan, total, mode)
    values (p_event_id, 'keluar', p_tanggal, nullif(trim(p_kategori), ''), nullif(trim(p_keterangan), ''), v_sum, p_mode)
    returning id into v_id;
  else
    update public.transactions
       set tanggal = p_tanggal,
           kategori = nullif(trim(p_kategori), ''),
           keterangan = nullif(trim(p_keterangan), ''),
           total = v_sum,
           mode = p_mode
     where id = p_transaction_id and jenis = 'keluar'
    returning id into v_id;
    if v_id is null then raise exception 'Pengeluaran tidak ditemukan'; end if;
    delete from public.expense_items where transaction_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    insert into public.expense_items (transaction_id, urutan, nama_barang, sub_barang, qty, satuan, harga_satuan, total_harga)
    values (
      v_id, v_n,
      trim(v_item ->> 'nama_barang'),
      nullif(trim(coalesce(v_item ->> 'sub_barang', '')), ''),
      (v_item ->> 'qty')::numeric,
      trim(v_item ->> 'satuan'),
      nullif(v_item ->> 'harga_satuan', '')::numeric,
      public._expense_item_total(v_item)
    );
  end loop;

  return v_id;
end $$;

revoke all on function public.save_expense(uuid, uuid, date, text, text, text, jsonb) from public, anon;
grant execute on function public.save_expense(uuid, uuid, date, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 4. RLS (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.transactions enable row level security;
alter table public.expense_items enable row level security;
alter table public.receipts enable row level security;
alter table public.audit_logs enable row level security;

-- hak akses tabel
revoke all on public.profiles, public.events, public.transactions, public.expense_items, public.receipts, public.audit_logs from anon, authenticated;
grant select on public.events, public.transactions, public.expense_items, public.receipts to anon, authenticated;
grant insert, update on public.events to authenticated;
grant insert, update, delete on public.transactions to authenticated;
grant insert, update, delete on public.receipts to authenticated;
grant select on public.profiles, public.audit_logs to authenticated;

-- profiles: user hanya bisa melihat profilnya sendiri (isi/ubah lewat SQL Editor saja)
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());

-- events: publik boleh lihat, bendahara boleh tambah/ubah (arsip = ubah status, tidak ada hapus)
drop policy if exists events_select on public.events;
create policy events_select on public.events for select to anon, authenticated using (true);
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated with check (public.is_bendahara());
drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (public.is_bendahara()) with check (public.is_bendahara());

-- transactions: publik lihat. Bendahara: pemasukan langsung ke tabel,
-- pengeluaran hanya lewat RPC save_expense (supaya total divalidasi server)
drop policy if exists tx_select on public.transactions;
create policy tx_select on public.transactions for select to anon, authenticated using (true);
drop policy if exists tx_insert on public.transactions;
create policy tx_insert on public.transactions for insert to authenticated
  with check (public.is_bendahara() and jenis = 'masuk');
drop policy if exists tx_update on public.transactions;
create policy tx_update on public.transactions for update to authenticated
  using (public.is_bendahara() and jenis = 'masuk')
  with check (public.is_bendahara() and jenis = 'masuk');
drop policy if exists tx_delete on public.transactions;
create policy tx_delete on public.transactions for delete to authenticated using (public.is_bendahara());

-- expense_items: publik lihat; tulis hanya lewat RPC
drop policy if exists items_select on public.expense_items;
create policy items_select on public.expense_items for select to anon, authenticated using (true);

-- receipts: publik hanya lihat bukti yang berstatus publik
drop policy if exists receipts_select on public.receipts;
create policy receipts_select on public.receipts for select to anon, authenticated
  using (is_public or public.is_bendahara());
drop policy if exists receipts_insert on public.receipts;
create policy receipts_insert on public.receipts for insert to authenticated with check (public.is_bendahara());
drop policy if exists receipts_update on public.receipts;
create policy receipts_update on public.receipts for update to authenticated
  using (public.is_bendahara()) with check (public.is_bendahara());
drop policy if exists receipts_delete on public.receipts;
create policy receipts_delete on public.receipts for delete to authenticated using (public.is_bendahara());

-- audit_logs: hanya bendahara yang bisa baca; tidak ada yang bisa tulis langsung (diisi trigger)
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using (public.is_bendahara());

-- ---------------------------------------------------------------------
-- 5. STORAGE: bucket "receipts" (privat, akses publik lewat signed URL
--    hanya untuk bukti yang berstatus publik)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists receipts_obj_select on storage.objects;
create policy receipts_obj_select on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'receipts' and (
      public.is_bendahara()
      or exists (select 1 from public.receipts r where r.file_path = objects.name and r.is_public)
    )
  );
drop policy if exists receipts_obj_insert on storage.objects;
create policy receipts_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_bendahara());
drop policy if exists receipts_obj_delete on storage.objects;
create policy receipts_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.is_bendahara());

-- ---------------------------------------------------------------------
-- 6. JADIKAN AKUN PERTAMA SEBAGAI BENDAHARA
-- Buat user dulu di Authentication > Users > Add user, lalu jalankan
-- (ganti email) SATU query ini terpisah:
--
-- insert into public.profiles (id, nama, role)
-- select id, 'Bendahara', 'bendahara' from auth.users where email = 'EMAIL_BENDAHARA@contoh.com'
-- on conflict (id) do update set role = 'bendahara';
-- ---------------------------------------------------------------------
