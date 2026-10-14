-- Estado partilhado por mês (visível para toda a equipa)
create table if not exists public.meses (
  id text primary key,                         -- ex.: '2018-05'
  ano int not null,
  mes int not null,
  estado text not null default 'por_iniciar',  -- por_iniciar | em_edicao | pronto | exportado
  pendentes int not null default 0,            -- linhas por resolver
  alteracoes int not null default 0,           -- alterações não exportadas em ficheiro
  em_edicao_por text,                          -- nome de quem está a tratar o mês
  em_edicao_desde timestamptz,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

-- Rascunho completo de cada mês (todas as linhas), gravado automaticamente
create table if not exists public.rascunhos (
  mes_id text primary key references public.meses(id) on delete cascade,
  dados jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

-- Histórico: quem fez o quê e quando
create table if not exists public.historico (
  id bigserial primary key,
  mes_id text not null,
  utilizador text,
  acao text not null,
  detalhe text,
  quando timestamptz not null default now()
);

alter table public.meses enable row level security;
alter table public.rascunhos enable row level security;
alter table public.historico enable row level security;

-- Só utilizadores autenticados (contas criadas pelo administrador) acedem. Sem acesso anónimo.
create policy "equipa lê meses" on public.meses for select to authenticated using (true);
create policy "equipa altera meses" on public.meses for all to authenticated using (true) with check (true);
create policy "equipa lê rascunhos" on public.rascunhos for select to authenticated using (true);
create policy "equipa altera rascunhos" on public.rascunhos for all to authenticated using (true) with check (true);
create policy "equipa lê histórico" on public.historico for select to authenticated using (true);
create policy "equipa regista histórico" on public.historico for insert to authenticated with check (true);

-- Actualizações em tempo real (para ver quem está a editar sem recarregar)
alter publication supabase_realtime add table public.meses;
alter publication supabase_realtime add table public.rascunhos;
