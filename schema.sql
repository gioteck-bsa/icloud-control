-- =========================================================================
-- ICLOUD CONTROL — Schema Supabase
-- Rode este arquivo inteiro no SQL Editor do seu projeto Supabase
-- (Dashboard > SQL Editor > New query > colar > Run)
-- =========================================================================

-- ---------- Tabela de clientes ----------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  account text not null,
  password text not null,
  usage_password text not null,
  phone text not null,
  access_key text not null,
  installments_total integer not null check (installments_total >= 0),
  installments_left integer not null check (installments_left >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

alter table public.clients enable row level security;

create policy "clients_select_authenticated"
  on public.clients for select
  to authenticated
  using (true);

create policy "clients_insert_authenticated"
  on public.clients for insert
  to authenticated
  with check (true);

create policy "clients_update_authenticated"
  on public.clients for update
  to authenticated
  using (true)
  with check (true);

create policy "clients_delete_authenticated"
  on public.clients for delete
  to authenticated
  using (true);

-- ---------- Trava: só senha / senha de tempo de uso podem mudar depois de criado ----------
-- (installments_left também pode mudar, mas só através da função de cobrança mensal abaixo,
--  o app nunca envia esse campo em uma edição manual)
create or replace function public.enforce_client_immutability()
returns trigger
language plpgsql
as $$
begin
  if new.name is distinct from old.name
     or new.account is distinct from old.account
     or new.phone is distinct from old.phone
     or new.access_key is distinct from old.access_key
     or new.installments_total is distinct from old.installments_total
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'Apenas os campos de senha podem ser alterados após o cadastro.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clients_immutability on public.clients;
create trigger trg_clients_immutability
  before update on public.clients
  for each row execute function public.enforce_client_immutability();

-- ---------- Controle de cobrança mensal ----------
create table if not exists public.billing_meta (
  id boolean primary key default true,
  last_processed_month text,
  constraint single_row check (id)
);
insert into public.billing_meta (id, last_processed_month)
  values (true, null)
  on conflict (id) do nothing;

alter table public.billing_meta enable row level security;
create policy "billing_meta_select_authenticated"
  on public.billing_meta for select to authenticated using (true);

-- Função chamada pelo app ao carregar a lista de clientes.
-- É segura para ser chamada várias vezes / por vários usuários ao mesmo tempo:
-- só desconta 1 parcela de cada cliente ativo uma vez por mês corrente.
create or replace function public.process_monthly_billing()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  now_key text := to_char(now(), 'YYYY-MM');
  rows_updated int;
begin
  update public.billing_meta
    set last_processed_month = now_key
    where id = true
      and (last_processed_month is distinct from now_key);
  get diagnostics rows_updated = row_count;

  if rows_updated > 0 then
    update public.clients
      set installments_left = installments_left - 1
      where installments_left > 0;
  end if;
end;
$$;

grant execute on function public.process_monthly_billing() to authenticated;

-- ---------------------------------------------------------------------------
-- IMPORTANTE — depois de rodar este script:
-- 1. Vá em Authentication > Providers > Email e DESATIVE "Allow new users to
--    sign up" (assim ninguém cria login sozinho, só quem você criar).
-- 2. Crie o primeiro usuário do sistema em Authentication > Users > Add user
--    (ou use a Edge Function admin-users depois de criar o primeiro manualmente).
-- 3. Em Authentication > Providers > Email, se quiser, também pode desativar
--    a confirmação por e-mail para simplificar o login interno da equipe.
-- ---------------------------------------------------------------------------
