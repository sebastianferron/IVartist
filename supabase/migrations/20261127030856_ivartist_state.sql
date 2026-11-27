create table public.ivartist_state_version (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0 check (revision >= 0)
);

insert into public.ivartist_state_version (singleton) values (true);

create table public.ivartist_documents (
  name text primary key check (name ~ '^[A-Za-z][A-Za-z0-9_.-]{0,95}$'),
  value jsonb not null
);

alter table public.ivartist_state_version enable row level security;
alter table public.ivartist_documents enable row level security;
revoke all on public.ivartist_state_version, public.ivartist_documents from public, anon, authenticated;
grant select, update on public.ivartist_state_version to service_role;
grant select, insert, update, delete on public.ivartist_documents to service_role;

create function public.ivartist_read_state()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'revision', revision,
    'documents', coalesce(
      (select jsonb_object_agg(name, value) from public.ivartist_documents),
      '{}'::jsonb
    )
  )
  from public.ivartist_state_version
  where singleton;
$$;

create function public.ivartist_commit_state(expected_revision bigint, changes jsonb, removed text[])
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_revision bigint;
begin
  update public.ivartist_state_version
  set revision = revision + 1
  where singleton and revision = expected_revision
  returning revision into next_revision;
  if not found then
    raise sqlstate 'PT409' using message = 'The site state has changed';
  end if;
  delete from public.ivartist_documents where name = any(removed);
  insert into public.ivartist_documents (name, value)
    select key, value from jsonb_each(changes)
    on conflict (name) do update set value = excluded.value;
  return next_revision;
end;
$$;

revoke all on function public.ivartist_read_state() from public, anon, authenticated;
revoke all on function public.ivartist_commit_state(bigint, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.ivartist_read_state() to service_role;
grant execute on function public.ivartist_commit_state(bigint, jsonb, text[]) to service_role;
