-- A file of its own, so the check from the file before is committed first: validating reads every
-- listing once (about a second per million rows) under a lock that lets reads and writes go on.
alter table listings validate constraint listings_gone_reason_check;
