-- Input format, output format and constraints are separate fields again, not part of the
-- markdown statement. Take back out the sections 0014 added, where the fields still hold them.
UPDATE "problems"
SET "description" = regexp_replace(
  "description",
  E'(^|\\n\\n)### (Input format|Output format|Constraints)\\n.*$',
  ''
)
WHERE jsonb_array_length("input_format") + jsonb_array_length("output_format") + jsonb_array_length("constraints") > 0;
