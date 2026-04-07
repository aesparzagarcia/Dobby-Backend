-- Baseline may have marked earlier migrations as applied without running SQL on this DB.
-- Ensures PostgreSQL enum "OrderStatus" includes ON_DELIVERY (rename from legacy IN_PROGRESS).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'OrderStatus'
      AND e.enumlabel = 'IN_PROGRESS'
  ) THEN
    ALTER TYPE "OrderStatus" RENAME VALUE 'IN_PROGRESS' TO 'ON_DELIVERY';
  END IF;
END $$;
