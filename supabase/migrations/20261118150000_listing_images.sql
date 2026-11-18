-- The preview photo a portal shows for a listing in its result list, as a link to the portal's
-- own image server. The photo itself is never copied: the visitor's browser loads it from there.
alter table listings add column image_url text;
