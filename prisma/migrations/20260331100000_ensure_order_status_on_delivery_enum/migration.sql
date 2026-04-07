-- Prisma expects OrderStatus.ON_DELIVERY; older DBs still have IN_PROGRESS.
-- Idempotent: safe if the rename already ran or if this migration runs twice.
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
