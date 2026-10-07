-- Placeholder makers ("Generic" …) are not part of the display name any more:
-- "Generic BNC Cable 1 m" becomes "BNC Cable 1 m". Only names that were made
-- automatically from manufacturer + model are changed; names set by hand stay.
UPDATE "equipment_type"
SET "name" = btrim("model")
WHERE lower(btrim("manufacturer")) IN ('generic', 'generisch', 'no name', 'noname', 'unbranded', 'diverse', 'various', '-')
  AND lower("name") = lower(btrim("manufacturer") || ' ' || btrim("model"));
