alter table public.time_logs
  drop constraint if exists time_logs_shift_assignment_id_fkey;

alter table public.time_logs
  add constraint time_logs_shift_assignment_id_fkey
  foreign key (shift_assignment_id)
  references public.shift_assignments(id)
  on delete set null;
