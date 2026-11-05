-- Audiences were one list of groups (any of them). They are now conditions that must all
-- hold; an old list becomes a single condition, which means the same.
UPDATE "contests" SET "audience" = jsonb_build_array("audience")
  WHERE jsonb_array_length("audience") > 0 AND jsonb_typeof("audience"->0) = 'string';
--> statement-breakpoint
UPDATE "assignments" SET "audience" = jsonb_build_array("audience")
  WHERE jsonb_array_length("audience") > 0 AND jsonb_typeof("audience"->0) = 'string';
