-- Remove per-break count and per-break duration enforcement.
-- Keep only total break minutes per shift policy.

do $$
begin
    if exists (
        select 1
        from pg_constraint
        where conname = 'break_policies_team_agreement_chk'
    ) then
        alter table public.break_policies
            drop constraint break_policies_team_agreement_chk;
    end if;

    alter table public.break_policies
        add constraint break_policies_team_agreement_chk
            check (max_total_break_minutes <= 60) not valid;
end $$;

create or replace function public.enforce_team_break_limits()
returns trigger
language plpgsql
as $$
declare
    v_staff_id uuid;
    v_shift_date date;
    v_shift_definition_id uuid;
    v_max_total integer := 60;
    v_total_completed integer := 0;
    v_open_break_id uuid;
    v_new_duration integer;
begin
    select tl.staff_id, tl.check_in::date
    into v_staff_id, v_shift_date
    from public.time_logs tl
    where tl.id = new.time_log_id;

    if v_staff_id is null then
        return new;
    end if;

    select sa.shift_definition_id
    into v_shift_definition_id
    from public.shift_assignments sa
    where sa.staff_id = v_staff_id
      and sa.shift_date = v_shift_date
    limit 1;

    select bp.max_total_break_minutes
    into v_max_total
    from public.break_policies bp
    where bp.shift_definition_id = v_shift_definition_id
    order by bp.created_at desc
    limit 1;

    if v_max_total is null then
        select bp.max_total_break_minutes
        into v_max_total
        from public.break_policies bp
        where bp.shift_definition_id is null
        order by bp.created_at desc
        limit 1;
    end if;

    v_max_total := least(coalesce(v_max_total, 60), 60);

    select coalesce(sum(duration_minutes), 0)
    into v_total_completed
    from public.breaks b
    where b.time_log_id = new.time_log_id
      and b.break_end is not null
      and (tg_op = 'INSERT' or b.id <> new.id);

    if tg_op = 'INSERT' and v_total_completed >= v_max_total then
        raise exception 'No break minutes remaining for this shift.';
    end if;

    if new.break_end is not null then
        v_new_duration := greatest(0, floor(extract(epoch from (new.break_end - new.break_start)) / 60)::int);
        if (v_total_completed + v_new_duration) > v_max_total then
            raise exception 'Break exceeded max total of % minutes for this shift.', v_max_total;
        end if;
        new.duration_minutes := v_new_duration;
    else
        select b.id
        into v_open_break_id
        from public.breaks b
        where b.time_log_id = new.time_log_id
          and b.break_end is null
          and (tg_op = 'INSERT' or b.id <> new.id)
        limit 1;

        if v_open_break_id is not null then
            raise exception 'A break is already active.';
        end if;
    end if;

    return new;
end;
$$;
