-- Per-slot break minutes on assignments + break_slot_index on each break row.
-- Replaces pool-based enforce_team_break_limits with slot-ordered sessions.

-- 1) shift_assignments: ordered slot lengths (minutes)
alter table if exists public.shift_assignments
    add column if not exists break_slot_minutes integer[] not null default '{}';

-- Backfill: one slot of length break_minutes_allowed, or no slots when 0
update public.shift_assignments
set
    break_slot_minutes = case
        when coalesce(break_minutes_allowed, 0) > 0
            then array[break_minutes_allowed]
        else '{}'::integer[]
    end
where true;

-- Keep break_minutes_allowed as sum of slot minutes
update public.shift_assignments sa
set break_minutes_allowed = coalesce(
    (select sum(s)::int from unnest(sa.break_slot_minutes) as s),
    0
);

-- 2) breaks: which slot (0-based) this session belongs to
alter table if exists public.breaks
    add column if not exists break_slot_index smallint not null default 0;

create or replace function public.enforce_team_break_limits()
returns trigger
language plpgsql
as $$
declare
    v_staff_id uuid;
    v_shift_date date;
    v_time_log_id uuid;
    v_slot_arr integer[];
    v_leg_mins int;
    v_k int;
    v_open_id uuid;
    v_new_duration int;
    v_idx int;
    v_cap int;
    v_n_slots int;
begin
    v_time_log_id := new.time_log_id;
    if v_time_log_id is null then
        return new;
    end if;

    select tl.staff_id, tl.check_in::date
    into v_staff_id, v_shift_date
    from public.time_logs tl
    where tl.id = v_time_log_id;

    if v_staff_id is null then
        return new;
    end if;

    v_slot_arr := null;
    v_leg_mins := 60;
    select sa.break_slot_minutes, sa.break_minutes_allowed
    into v_slot_arr, v_leg_mins
    from public.shift_assignments sa
    where sa.time_log_id = v_time_log_id
    limit 1;

    if v_slot_arr is null or coalesce(array_length(v_slot_arr, 1), 0) = 0 then
        select sa.break_slot_minutes, sa.break_minutes_allowed
        into v_slot_arr, v_leg_mins
        from public.shift_assignments sa
        where sa.staff_id = v_staff_id
          and sa.shift_date = v_shift_date
        limit 1;
    end if;

    v_leg_mins := coalesce(v_leg_mins, 0);
    v_n_slots := coalesce(array_length(v_slot_arr, 1), 0);
    if v_n_slots = 0 and v_leg_mins > 0 then
        v_slot_arr := array[v_leg_mins];
        v_n_slots := 1;
    end if;

    -- Closing a break: cap duration to slot minutes (values set by clock-action/TS are redundant; trigger is source of truth)
    if new.break_end is not null then
        v_new_duration := greatest(0, floor(
            extract(epoch from (new.break_end - new.break_start)) / 60.0
        )::int);

        v_idx := coalesce(new.break_slot_index, old.break_slot_index, 0);

        v_cap := v_new_duration;
        if v_n_slots > 0 and v_idx >= 0 and v_idx < v_n_slots then
            v_cap := v_slot_arr[v_idx + 1];
        end if;
        v_new_duration := least(v_new_duration, v_cap);
        new.duration_minutes := v_new_duration;
        return new;
    end if;

    -- Open break row (new.break_end is null)
    if v_n_slots = 0 or v_slot_arr is null then
        raise exception 'No break allowed for this assigned shift.';
    end if;

    select count(*)
    into v_k
    from public.breaks b
    where b.time_log_id = v_time_log_id
      and b.break_end is not null
      and (tg_op = 'INSERT' or b.id <> new.id);

    if v_k >= v_n_slots then
        raise exception 'No more breaks for this shift.';
    end if;

    if new.break_slot_index is not null and new.break_slot_index <> v_k then
        raise exception 'Invalid break slot index (expected %, got %).', v_k, new.break_slot_index;
    end if;
    new.break_slot_index := v_k;

    select b.id
    into v_open_id
    from public.breaks b
    where b.time_log_id = v_time_log_id
      and b.break_end is null
      and (tg_op = 'INSERT' or b.id <> new.id)
    limit 1;

    if v_open_id is not null then
        raise exception 'A break is already active.';
    end if;

    return new;
end;
$$;

comment on function public.enforce_team_break_limits() is
'Slot-based break limits. INSERT open break only if k < n slots and index matches. UPDATE close caps duration to break_slot_minutes[break_slot_index+1].';
