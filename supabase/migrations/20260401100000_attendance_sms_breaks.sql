-- Attendance SMS + break controls + day-based shift templates

alter table if exists public.staff
    add column if not exists phone_number text,
    add column if not exists sms_opt_in boolean not null default true;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'staff_phone_e164_chk'
    ) then
        alter table public.staff
            add constraint staff_phone_e164_chk
                check (phone_number is null or phone_number ~ '^\+[1-9][0-9]{7,14}$');
    end if;
end $$;

create table if not exists public.late_attendance_notifications (
    id uuid primary key default gen_random_uuid(),
    staff_id uuid not null references public.staff(id) on delete cascade,
    shift_assignment_id uuid references public.shift_assignments(id) on delete set null,
    shift_date date not null,
    notification_type text not null default 'late_checkin_sms',
    sms_message text not null,
    status text not null default 'pending',
    scheduled_at timestamptz not null default now(),
    sent_at timestamptz,
    provider_response jsonb,
    error_message text,
    created_at timestamptz not null default now()
);

create unique index if not exists late_attendance_notifications_dedupe_idx
    on public.late_attendance_notifications (staff_id, shift_date, notification_type);

create index if not exists late_attendance_notifications_staff_idx
    on public.late_attendance_notifications (staff_id, created_at desc);

create table if not exists public.late_attendance_reasons (
    id uuid primary key default gen_random_uuid(),
    staff_id uuid not null references public.staff(id) on delete cascade,
    shift_assignment_id uuid references public.shift_assignments(id) on delete set null,
    time_log_id uuid references public.time_logs(id) on delete set null,
    reason_text text not null,
    source text not null default 'app',
    reason_date date not null default current_date,
    submitted_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create unique index if not exists late_reasons_unique_per_shift_day_idx
    on public.late_attendance_reasons (staff_id, shift_assignment_id, reason_date)
    where shift_assignment_id is not null;

create index if not exists late_reasons_staff_idx
    on public.late_attendance_reasons (staff_id, submitted_at desc);

create table if not exists public.shift_template_days (
    id uuid primary key default gen_random_uuid(),
    shift_definition_id uuid not null references public.shift_definitions(id) on delete cascade,
    day_of_week smallint not null check (day_of_week between 0 and 6),
    active boolean not null default true,
    created_at timestamptz not null default now()
);

create unique index if not exists shift_template_days_unique_idx
    on public.shift_template_days (shift_definition_id, day_of_week);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'break_policies_team_agreement_chk'
    ) then
        alter table public.break_policies
            add constraint break_policies_team_agreement_chk
                check (
                    max_breaks <= 99
                    and max_break_duration_minutes <= 60
                    and max_total_break_minutes <= 60
                ) not valid;
    else
        alter table public.break_policies
            drop constraint break_policies_team_agreement_chk;
        alter table public.break_policies
            add constraint break_policies_team_agreement_chk
                check (
                    max_breaks <= 99
                    and max_break_duration_minutes <= 60
                    and max_total_break_minutes <= 60
                ) not valid;
    end if;
end $$;

create or replace function public.enforce_team_break_limits()
returns trigger
language plpgsql
as $$
declare
    v_staff_id uuid;
    v_shift_date date;
    v_shift_definition_id uuid;
    v_max_breaks integer := 99;
    v_max_break_duration integer := 60;
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

    select sa.shift_definition_id
    into v_shift_definition_id
    from public.shift_assignments sa
    where sa.staff_id = v_staff_id
      and sa.shift_date = v_shift_date
    limit 1;

    select bp.max_breaks, bp.max_break_duration_minutes, bp.max_total_break_minutes
    into v_max_breaks, v_max_break_duration, v_max_total
    from public.break_policies bp
    where bp.shift_definition_id = v_shift_definition_id
    order by bp.created_at desc
    limit 1;

    if v_max_breaks is null then
        select bp.max_breaks, bp.max_break_duration_minutes, bp.max_total_break_minutes
        into v_max_breaks, v_max_break_duration, v_max_total
        from public.break_policies bp
        where bp.shift_definition_id is null
        order by bp.created_at desc
        limit 1;
    end if;

    v_max_breaks := coalesce(v_max_breaks, 99);
    v_max_break_duration := least(coalesce(v_max_break_duration, 60), 60);
    v_max_total := least(coalesce(v_max_total, 60), 60);

    select count(*)
    into v_existing_breaks
    from public.breaks b
    where b.time_log_id = new.time_log_id
      and (tg_op = 'INSERT' or b.id <> new.id);

    if tg_op = 'INSERT' and v_existing_breaks >= v_max_breaks then
        raise exception 'You already used the maximum number of breaks (%).', v_max_breaks;
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
        if v_new_duration > v_max_break_duration then
            raise exception 'Break exceeded max duration (% minutes).', v_max_break_duration;
        end if;
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

drop trigger if exists trg_enforce_team_break_limits on public.breaks;
create trigger trg_enforce_team_break_limits
before insert or update of break_start, break_end
on public.breaks
for each row
execute function public.enforce_team_break_limits();
