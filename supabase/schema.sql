-- As Minhas Despesas: um documento JSON por utilizador.
-- Executar no SQL Editor do Supabase. Não guarda palavras-passe bancárias.
create table if not exists public.user_finances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_finances enable row level security;

revoke all on public.user_finances from anon;
grant select, insert, update, delete on public.user_finances to authenticated;

drop policy if exists "Ler apenas os meus dados" on public.user_finances;
create policy "Ler apenas os meus dados" on public.user_finances
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Criar apenas os meus dados" on public.user_finances;
create policy "Criar apenas os meus dados" on public.user_finances
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Alterar apenas os meus dados" on public.user_finances;
create policy "Alterar apenas os meus dados" on public.user_finances
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Apagar apenas os meus dados" on public.user_finances;
create policy "Apagar apenas os meus dados" on public.user_finances
for delete to authenticated using ((select auth.uid()) = user_id);
