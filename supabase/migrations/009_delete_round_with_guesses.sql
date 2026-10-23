-- BibleGuessr 009: a round can be deleted even when it already has guesses.
-- Only that round's guesses are removed. Later rounds move up to fill the gap.
-- Run after 008 in the Supabase SQL editor.

create or replace function host_delete_verse(p_round int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  gs game_state%rowtype;
  next_current int;
  prof smallint := current_profile();
begin
  if not exists (select 1 from verses where round_number = p_round and profile = prof) then
    raise exception 'That round does not exist';
  end if;

  delete from guesses where round_number = p_round and profile = prof;
  delete from round_flags where round_number = p_round and profile = prof;
  delete from verses where round_number = p_round and profile = prof;

  update verses set round_number = -round_number
  where profile = prof and round_number > p_round;
  update verses set round_number = (-round_number) - 1
  where profile = prof and round_number < 0;

  update guesses set round_number = -round_number
  where profile = prof and round_number > p_round;
  update guesses set round_number = (-round_number) - 1
  where profile = prof and round_number < 0;

  update round_flags set round_number = -round_number
  where profile = prof and round_number > p_round;
  update round_flags set round_number = (-round_number) - 1
  where profile = prof and round_number < 0;

  select * into gs from game_state where id = 1;
  if gs.current_round = p_round then
    select coalesce(max(round_number), 1) into next_current
    from verses
    where profile = prof;
    next_current := least(p_round, next_current);
    update game_state
      set current_round = greatest(next_current, 1),
          phase = 'lobby',
          between_rounds = false,
          standings_revealed = false,
          guessing_ends_at = null,
          timer_paused = false,
          timer_remaining_ms = timer_duration_ms,
          round_started_at = null,
          updated_at = now()
    where id = 1;
  elsif gs.current_round > p_round then
    update game_state set current_round = gs.current_round - 1, updated_at = now() where id = 1;
  end if;

  perform rebuild_public_snapshot();
  return host_state();
end;
$$;

revoke all on function host_delete_verse(int) from public;
grant execute on function host_delete_verse(int) to anon, authenticated, service_role;
