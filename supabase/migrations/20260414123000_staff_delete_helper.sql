-- Safe permanent delete helper for staff records.
-- Returns structured JSON so the UI can show clear errors.

create or replace function public.delete_staff_permanently(
    p_staff_id uuid,
    p_actor_admin_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_staff record;
    v_open_logs integer := 0;
begin
    if p_staff_id is null then
        return jsonb_build_object('ok', false, 'error', 'Missing staff id.');
    end if;

    select id, role, active, name
    into v_staff
    from public.staff
    where id = p_staff_id
    limit 1;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'Staff member not found.');
    end if;

    if coalesce(v_staff.role, '') = 'admin' then
        return jsonb_build_object('ok', false, 'error', 'Admin accounts cannot be permanently deleted.');
    end if;

    select count(*)
    into v_open_logs
    from public.time_logs
    where staff_id = p_staff_id
      and check_out is null;

    if v_open_logs > 0 then
        return jsonb_build_object('ok', false, 'error', 'Staff has an open time log. Check out first.');
    end if;

    begin
        delete from public.staff where id = p_staff_id;
    exception
        when foreign_key_violation then
            return jsonb_build_object(
                'ok', false,
                'error', 'Cannot delete this staff member because related records exist. Deactivate instead.',
                'code', SQLSTATE,
                'detail', SQLERRM
            );
    end;

    if not found then
        return jsonb_build_object('ok', false, 'error', 'Staff could not be deleted.');
    end if;

    if p_actor_admin_id is not null then
        begin
            insert into public.audit_logs (admin_id, action, target_staff_id, details)
            values (
                p_actor_admin_id,
                'delete_staff_permanently',
                p_staff_id,
                jsonb_build_object('staff_name', v_staff.name, 'deleted_at', now())
            );
        exception
            when undefined_table or undefined_column then
                null;
        end;
    end if;

    return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.delete_staff_permanently(uuid, uuid) from public;
grant execute on function public.delete_staff_permanently(uuid, uuid) to anon, authenticated, service_role;
