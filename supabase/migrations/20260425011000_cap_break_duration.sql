create or replace function public.enforce_team_break_limits()
returns trigger
language plpgsql
as $$
declare
    v_staff_id uuid;
    v_shift_date date;
    v_break_minutes_allowed integer := 60;
    v_max_total integer := 60;
    v_existing_breaks integer := 0;
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

    select sa.break_minutes_allowed
    into v_break_minutes_allowed
    from public.shift_assignments sa
    where sa.time_log_id = new.time_log_id
    limit 1;

    if v_break_minutes_allowed is null then
        select sa.break_minutes_allowed
        into v_break_minutes_allowed
        from public.shift_assignments sa
        where sa.staff_id = v_staff_id
          and sa.shift_date = v_shift_date
        limit 1;
    end if;

    v_max_total := greatest(coalesce(v_break_minutes_allowed, 60), 0);

    if tg_op = 'INSERT' and v_max_total = 0 then
        raise exception 'No break allowed for this assigned shift.';
    end if;

    select count(*)
    into v_existing_breaks
    from public.breaks b
    where b.time_log_id = new.time_log_id
      and (tg_op = 'INSERT' or b.id <> new.id);

    if tg_op = 'INSERT' and v_existing_breaks >= 99 then
        raise exception 'You already used the maximum number of breaks (%).', 99;
    end if;

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
            -- FIX: Instead of throwing an exception and causing the break to get stuck forever,
            -- cap the recorded duration to the maximum allowed.
            v_new_duration := greatest(0, v_max_total - v_total_completed);
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
