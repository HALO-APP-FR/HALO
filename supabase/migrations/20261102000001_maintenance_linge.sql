-- =====================================================================
-- Maintenance et linge dans « logement prêt »
-- - nouveau type de mission « maintenance » (intervention technique) ;
-- - un incident peut déclencher une intervention planifiée, reliée à la prochaine arrivée du logement.
-- =====================================================================
alter type public.task_type add value if not exists 'maintenance';

alter table public.incidents add column follow_up_task_id uuid;
alter table public.incidents add constraint incidents_follow_up_fk
  foreign key (organization_id, follow_up_task_id) references public.tasks (organization_id, id) on delete set null (follow_up_task_id);

-- Intervention suite à un incident : mission de maintenance avant la prochaine arrivée du logement
create function public.create_intervention(org uuid, incident uuid, assignee uuid, w_start timestamptz, w_end timestamptz, duration int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.incidents; nxt uuid; tid uuid;
begin
  if not public.is_manager(org) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into i from public.incidents where organization_id = org and id = incident for update;
  if i.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if i.status = 'resolved' then raise exception 'already_resolved' using errcode = '22023'; end if;
  if w_end <= w_start or duration < 5 then raise exception 'invalid_window' using errcode = '22023'; end if;
  -- L'agent choisi doit être membre actif de la même organisation (la clé composite le garantit aussi)
  if assignee is not null and not exists (select 1 from public.memberships where organization_id = org and user_id = assignee and is_active) then
    raise exception 'not_member' using errcode = '22023';
  end if;
  select r.id into nxt from public.reservations r
   where r.organization_id = org and r.property_id = i.property_id and r.status = 'confirmed' and r.check_in_at >= w_start
   order by r.check_in_at limit 1;
  insert into public.tasks (organization_id, property_id, next_reservation_id, type, status, priority, is_auto_generated,
                            title, window_start, window_end, duration_min, assignee_id, notes)
  values (org, i.property_id, nxt, 'maintenance', case when assignee is null then 'unassigned' else 'assigned' end::public.task_status,
          case when i.urgent then 'urgent' else 'normal' end::public.task_priority, false,
          left(i.description, 200), w_start, w_end, least(duration, 1440), assignee, i.description)
  returning id into tid;
  update public.incidents set follow_up_task_id = tid, status = 'in_progress',
    taken_by = coalesce(taken_by, (select auth.uid())), taken_at = coalesce(taken_at, now()), manager_unread = false
  where id = i.id;
  return tid;
end $$;

revoke all on function public.create_intervention(uuid, uuid, uuid, timestamptz, timestamptz, int) from public, anon;
grant execute on function public.create_intervention(uuid, uuid, uuid, timestamptz, timestamptz, int) to authenticated;
