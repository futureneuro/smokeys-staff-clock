-- Require a photo before a task can be completed.
--
-- From the original request: "within the task list we need to put requirement
-- on some of the tasks that they need to upload images before doing the
-- checklist".
--
-- Purely additive. Both columns default to false, so every task and template
-- that already exists keeps behaving exactly as it does today.
--
-- The tasks tables were created outside this migrations folder, so every
-- statement is guarded — this file must be a no-op on a database that does not
-- have them yet.

do $$
begin
    if to_regclass('public.task_templates') is not null then
        alter table public.task_templates
            add column if not exists requires_photo boolean not null default false;
    end if;

    if to_regclass('public.tasks') is not null then
        -- Copied from the template when the task is assigned, and overridable
        -- per task: a template may generally need proof while one particular
        -- assignment does not, or the reverse.
        alter table public.tasks
            add column if not exists requires_photo boolean not null default false;

        -- When the proof photo was accepted. tasks.proof_url already existed
        -- but was never populated; this records that it arrived deliberately
        -- rather than being back-filled.
        alter table public.tasks
            add column if not exists proof_uploaded_at timestamptz;

        create index if not exists tasks_requires_photo_idx
            on public.tasks (requires_photo) where requires_photo = true;
    end if;
end $$;

-- Blocking completion is enforced in the app, but also here: the staff client
-- talks to PostgREST directly with the anon key, so a check constraint is the
-- only thing that actually cannot be bypassed.
do $$
begin
    if to_regclass('public.tasks') is not null
       and not exists (
           select 1 from pg_constraint where conname = 'tasks_photo_required_before_complete_chk'
       )
    then
        alter table public.tasks
            add constraint tasks_photo_required_before_complete_chk
            check (
                requires_photo = false
                or status <> 'Completed'
                or (proof_url is not null and btrim(proof_url) <> '')
            )
            -- not valid: existing rows are untouched, only new writes are checked.
            not valid;
    end if;
end $$;
