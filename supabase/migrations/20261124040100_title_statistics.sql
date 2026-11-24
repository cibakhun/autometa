-- The free-text search filters titles with "ilike '%word%'" (trigram index). With the default
-- sample Postgres guessed a word found in 1 % of 850,000 titles at 0.01 %, and then compared the
-- duplicates among the 8,000 matches each with each (0.4 s instead of 0.04 s). A larger sample
-- of titles makes the guess close. ANALYZE then takes about 2 s instead of 0.6 s; autovacuum runs
-- it in the background. Run once here, so the new sort indexes (one on an expression) and the
-- titles have their statistics right away. It blocks neither reads nor writes.
alter table listings alter column title set statistics 300;
analyze listings;
