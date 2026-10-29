-- Suppression d'une organisation (ou d'un compte) : le journal des missions ne doit pas bloquer la cascade.
-- Pendant la suppression, les missions perdent leur assignation (ON DELETE SET NULL) juste avant d'être
-- elles-mêmes supprimées ; le journal tentait alors d'écrire un événement pour une mission en cours
-- de suppression, ce qui faisait échouer toute la suppression.
create or replace function public.log_task_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  -- Organisation ou mission en cours de suppression : rien à journaliser
  if not exists (select 1 from public.organizations where id = new.organization_id)
     or (tg_op = 'UPDATE' and not exists (select 1 from public.tasks where organization_id = new.organization_id and id = new.id)) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into public.task_events (organization_id, task_id, kind, to_status, actor_id)
    values (new.organization_id, new.id, 'created', new.status, (select auth.uid()));
    return new;
  end if;
  if new.status is distinct from old.status then
    k := case
      when new.status = 'in_progress' then 'started'
      when new.status = 'done' then 'submitted'
      when new.status = 'validated' and old.status = 'in_progress' then 'auto_validated'
      when new.status = 'validated' then 'validated'
      when new.status = 'to_redo' then 'correction_requested'
      when new.status = 'cancelled' then 'cancelled'
      else 'status_changed' end;
    insert into public.task_events (organization_id, task_id, kind, from_status, to_status, actor_id, note)
    values (new.organization_id, new.id, k, old.status, new.status, (select auth.uid()),
            case when new.status = 'to_redo' then new.correction_reason end);
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.task_events (organization_id, task_id, kind, actor_id, note)
    values (new.organization_id, new.id, case when new.assignee_id is null then 'unassigned' else 'assigned' end,
            (select auth.uid()), new.assignee_id::text);
  end if;
  return new;
end $$;
revoke all on function public.log_task_change() from public, anon, authenticated;
