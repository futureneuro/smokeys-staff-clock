-- Ensure one active (open) break per time log.
-- 1) Clean existing duplicate open rows.
-- 2) Add partial unique index to prevent recurrence.

with ranked_open_breaks as (
    select
        id,
        break_start,
        row_number() over (
            partition by time_log_id
            order by break_start desc, id desc
        ) as rn
    from public.breaks
    where break_end is null
),
to_close as (
    select id, break_start
    from ranked_open_breaks
    where rn > 1
)
update public.breaks b
set
    break_end = c.break_start,
    duration_minutes = 0
from to_close c
where b.id = c.id;

create unique index if not exists breaks_one_open_per_time_log_idx
    on public.breaks (time_log_id)
    where break_end is null;
