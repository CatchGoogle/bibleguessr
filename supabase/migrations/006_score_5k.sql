-- BibleGuessr 006: an exact book, chapter, and verse is 5,000.
-- Point bands keep the previous proportions (multiplied by 50).
-- Run after 005. Existing guesses are rescored in place.

create or replace function score_guess(
  p_guess_book text,
  p_guess_chapter int,
  p_guess_verse int,
  p_answer_book text,
  p_answer_chapter int,
  p_answer_verse int,
  out book_score int,
  out chapter_score int,
  out verse_score int,
  out base_score int
)
language plpgsql
immutable
as $$
declare
  gname text;
  aname text;
  gi int;
  ai int;
  distance int;
  chapter_distance int;
  verse_distance int;
  exact boolean;
begin
  gname := canonical_book(p_guess_book);
  aname := canonical_book(p_answer_book);
  gi := array_position(canon_books(), gname);
  ai := array_position(canon_books(), aname);
  if gi is null or ai is null then
    book_score := 0;
    chapter_score := 0;
    verse_score := 0;
    base_score := 0;
    return;
  end if;

  distance := abs(gi - ai);
  exact := gname = aname;
  if exact then
    book_score := 2500;
  elsif distance <= 3 then
    book_score := 2000;
  elsif distance <= 5 then
    book_score := 1000;
  elsif distance <= 10 then
    book_score := 500;
  else
    book_score := 0;
  end if;

  chapter_score := 0;
  verse_score := 0;
  if exact or distance <= 3 then
    chapter_distance := abs(p_guess_chapter - p_answer_chapter);
    if chapter_distance = 0 then chapter_score := 1500;
    elsif chapter_distance <= 3 then chapter_score := 1000;
    elsif chapter_distance <= 5 then chapter_score := 500;
    elsif chapter_distance <= 10 then chapter_score := 250;
    end if;

    verse_distance := abs(p_guess_verse - p_answer_verse);
    if verse_distance = 0 then verse_score := 1000;
    elsif verse_distance <= 3 then verse_score := 500;
    elsif verse_distance <= 5 then verse_score := 250;
    elsif verse_distance <= 10 then verse_score := 150;
    end if;
  end if;

  base_score := book_score + chapter_score + verse_score;
end;
$$;

do $$
declare
  r int;
begin
  for r in select distinct round_number from guesses loop
    perform rescore_round_answers(r);
  end loop;
  perform rebuild_public_snapshot();
end $$;
