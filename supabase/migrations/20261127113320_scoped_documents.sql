create function public.ivartist_read_documents(document_names text[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'revision', revision,
    'documents', coalesce(
      (select jsonb_object_agg(name, value)
       from public.ivartist_documents
       where name = any(document_names)),
      '{}'::jsonb
    )
  )
  from public.ivartist_state_version
  where singleton;
$$;

-- Uses the same lock as ivartist_commit_state. Detached senders compare only
-- the documents they update, so unrelated writes do not invalidate an ack.
create function public.ivartist_commit_documents(expected jsonb, changes jsonb, removed text[])
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_revision bigint;
begin
  select revision into strict next_revision
    from public.ivartist_state_version where singleton for update;

  if exists (
    select 1
    from (select key as name from jsonb_each(changes) union select unnest(removed)) as touched
    left join public.ivartist_documents as stored using (name)
    where stored.value is distinct from (expected -> touched.name)
  ) then
    raise sqlstate 'PT409' using message = 'The site document has changed';
  end if;

  return public.ivartist_commit_state(next_revision, changes, removed);
end;
$$;

revoke all on function public.ivartist_read_documents(text[]) from public, anon, authenticated;
revoke all on function public.ivartist_commit_documents(jsonb, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.ivartist_read_documents(text[]) to service_role;
grant execute on function public.ivartist_commit_documents(jsonb, jsonb, text[]) to service_role;

create role ivartist_worker nologin noinherit;
grant ivartist_worker to authenticator;
grant usage on schema public to ivartist_worker;
grant select, update on public.ivartist_state_version to ivartist_worker;
grant select, insert, update, delete on public.ivartist_documents to ivartist_worker;
create policy ivartist_worker_revision_read on public.ivartist_state_version for select to ivartist_worker using (singleton);
create policy ivartist_worker_revision_write on public.ivartist_state_version for update to ivartist_worker using (singleton) with check (singleton);
create policy ivartist_worker_documents on public.ivartist_documents for all to ivartist_worker using (true) with check (true);
grant execute on function public.ivartist_read_state() to ivartist_worker;
grant execute on function public.ivartist_commit_state(bigint, jsonb, text[]) to ivartist_worker;
grant execute on function public.ivartist_read_documents(text[]) to ivartist_worker;
grant execute on function public.ivartist_commit_documents(jsonb, jsonb, text[]) to ivartist_worker;
