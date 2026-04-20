-- ============================================================
-- Schema do QA Assistant — executar no SQL Editor do Supabase
-- ============================================================

create extension if not exists "pgcrypto";

-- Planos de teste (únicos por projeto+sprint+hu)
create table if not exists public.test_plans (
  id uuid primary key default gen_random_uuid(),
  projeto text not null,
  sprint text not null,
  tela text,
  hu text not null,
  hu_hash text not null,
  tipo_sistema text,
  criticidade text,
  resultado_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint test_plans_unique_key unique (projeto, sprint, hu_hash)
);

create index if not exists idx_test_plans_projeto_sprint
  on public.test_plans (projeto, sprint, updated_at desc);

-- Execuções por caso de teste (um registro por caso dentro do plano)
create table if not exists public.test_case_executions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.test_plans(id) on delete cascade,
  case_id text not null,
  titulo text,
  tipo text,
  origem text,
  status text not null default 'nao_executado'
    check (status in ('nao_executado','passou','falhou')),
  fail_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint test_case_executions_unique unique (plan_id, case_id)
);

create index if not exists idx_executions_plan on public.test_case_executions (plan_id);

-- Histórico de falhas (uma linha por ocorrência)
create table if not exists public.test_case_fail_history (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.test_plans(id) on delete cascade,
  case_id text not null,
  observacao text,
  created_at timestamptz not null default now()
);

create index if not exists idx_fail_history_plan_case
  on public.test_case_fail_history (plan_id, case_id, created_at desc);

-- Trigger para manter updated_at em test_plans
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_test_plans_touch on public.test_plans;
create trigger trg_test_plans_touch
before update on public.test_plans
for each row execute function public.touch_updated_at();

drop trigger if exists trg_executions_touch on public.test_case_executions;
create trigger trg_executions_touch
before update on public.test_case_executions
for each row execute function public.touch_updated_at();

-- ============================================================
-- RLS: aberta para anon (uso interno sem login)
-- Se quiser restringir depois, troque as políticas por auth.uid().
-- ============================================================
alter table public.test_plans enable row level security;
alter table public.test_case_executions enable row level security;
alter table public.test_case_fail_history enable row level security;

drop policy if exists "anon all test_plans" on public.test_plans;
create policy "anon all test_plans" on public.test_plans
  for all using (true) with check (true);

drop policy if exists "anon all executions" on public.test_case_executions;
create policy "anon all executions" on public.test_case_executions
  for all using (true) with check (true);

drop policy if exists "anon all fail_history" on public.test_case_fail_history;
create policy "anon all fail_history" on public.test_case_fail_history
  for all using (true) with check (true);
