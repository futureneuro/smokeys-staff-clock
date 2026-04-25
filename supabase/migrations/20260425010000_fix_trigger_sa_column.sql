-- Add the missing time_log_id column to shift_assignments
-- This was causing the trg_enforce_team_break_limits trigger to crash when evaluating break times
alter table if exists public.shift_assignments
    add column if not exists time_log_id uuid references public.time_logs(id) on delete set null;
