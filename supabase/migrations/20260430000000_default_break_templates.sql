-- Add default break template columns to settings table

alter table if exists public.settings
    add column if not exists default_break_short integer[] not null default '{15}',
    add column if not exists default_break_medium integer[] not null default '{30}',
    add column if not exists default_break_long integer[] not null default '{30, 30}';
