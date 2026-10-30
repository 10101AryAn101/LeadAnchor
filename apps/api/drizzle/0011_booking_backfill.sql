-- Visits set on jobs before online booking existed become bookings, so they hold their time
-- (nobody can book over them) and get the day-before reminder. Their customer link is made
-- when the first message about them goes out.
INSERT INTO "bookings" ("id", "tenant_id", "lead_id", "customer_id", "starts_at", "ends_at", "status", "source", "canceled_at", "canceled_by", "cancel_reason", "created_by")
SELECT
  uuidv7(),
  l."tenant_id",
  l."id",
  l."customer_id",
  l."scheduled_for",
  l."scheduled_for" + interval '60 minutes',
  CASE l."stage" WHEN 'won' THEN 'completed' WHEN 'lost' THEN 'canceled' ELSE 'booked' END,
  'owner',
  CASE WHEN l."stage" = 'lost' THEN l."stage_changed_at" END,
  CASE WHEN l."stage" = 'lost' THEN 'owner' END,
  CASE WHEN l."stage" = 'lost' THEN 'Job lost' END,
  'system'
FROM "leads" l
WHERE l."scheduled_for" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "bookings" b WHERE b."lead_id" = l."id");
