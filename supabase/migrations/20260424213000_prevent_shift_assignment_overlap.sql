-- Prevent overlapping shift assignments for the same staff on the same date.

create or replace function public.shift_times_overlap(
    p_start_a time,
    p_end_a time,
    p_start_b time,
    p_end_b time
)
returns boolean
language plpgsql
immutable
as $$
declare
    a_start integer := extract(hour from p_start_a)::integer * 60 + extract(minute from p_start_a)::integer;
    a_end integer := extract(hour from p_end_a)::integer * 60 + extract(minute from p_end_a)::integer;
    b_start integer := extract(hour from p_start_b)::integer * 60 + extract(minute from p_start_b)::integer;
    b_end integer := extract(hour from p_end_b)::integer * 60 + extract(minute from p_end_b)::integer;
begin
    -- Equal start/end means full-day availability.
    if a_start = a_end or b_start = b_end then
        return true;
    end if;

    if a_end > a_start and b_end > b_start then
        return greatest(a_start, b_start) < least(a_end, b_end);
    end if;

    if a_end <= a_start and b_end > b_start then
        return greatest(a_start, b_start) < least(1440, b_end)
            or greatest(0, b_start) < least(a_end, b_end);
    end if;

    if a_end > a_start and b_end <= b_start then
        return greatest(a_start, b_start) < least(a_end, 1440)
            or greatest(a_start, 0) < least(a_end, b_end);
    end if;

    return greatest(a_start, b_start) < least(1440, 1440)
        or greatest(0, b_start) < least(a_end, 1440)
        or greatest(a_start, 0) < least(1440, b_end)
        or greatest(0, 0) < least(a_end, b_end);
end;
$$;

create or replace function public.prevent_shift_assignment_overlap()
returns trigger
language plpgsql
as $$
declare
    v_new_start time;
    v_new_end time;
    v_conflict_id uuid;
begin
    if new.staff_id is null or new.shift_date is null or new.shift_definition_id is null then
        return new;
    end if;

    select sd.start_time, sd.end_time
    into v_new_start, v_new_end
    from public.shift_definitions sd
    where sd.id = new.shift_definition_id;

    if v_new_start is null or v_new_end is null then
        return new;
    end if;

    select sa.id
    into v_conflict_id
    from public.shift_assignments sa
    join public.shift_definitions sd on sd.id = sa.shift_definition_id
    where sa.staff_id = new.staff_id
      and sa.shift_date = new.shift_date
      and sa.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and public.shift_times_overlap(v_new_start, v_new_end, sd.start_time, sd.end_time)
    limit 1;

    if v_conflict_id is not null then
        raise exception 'Staff member already has an overlapping shift assignment on %.', new.shift_date;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_prevent_shift_assignment_overlap on public.shift_assignments;
create trigger trg_prevent_shift_assignment_overlap
before insert or update of shift_definition_id, shift_date, staff_id
on public.shift_assignments
for each row
execute function public.prevent_shift_assignment_overlap();
