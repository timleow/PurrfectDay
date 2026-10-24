-- Allow families to define and customize the care actions shown in the tracker.
-- Care events keep display snapshots so later action edits never rewrite history.
alter table public.families
  add column care_actions jsonb not null default '[]'::jsonb
  check (jsonb_typeof(care_actions) = 'array');

alter table public.care_events
  drop constraint if exists care_events_metric_check,
  add column action_name_snapshot text,
  add column action_icon_snapshot text,
  add column action_unit_snapshot text;

alter table public.target_rules
  drop constraint if exists target_rules_metric_check,
  drop constraint if exists target_rules_cadence_check;

alter table public.target_rules
  add constraint target_rules_cadence_check check (cadence in ('daily', 'weekly', 'monthly'));

comment on column public.families.care_actions is 'Family customizations and custom care action definitions.';
comment on column public.care_events.action_name_snapshot is 'Action label captured when the event was recorded.';
comment on column public.care_events.action_icon_snapshot is 'Action icon key captured when the event was recorded.';
comment on column public.care_events.action_unit_snapshot is 'Action unit captured when the event was recorded.';
