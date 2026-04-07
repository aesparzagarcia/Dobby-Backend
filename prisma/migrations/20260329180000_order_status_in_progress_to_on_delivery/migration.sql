-- Rename OrderStatus enum value (PostgreSQL 10+)
ALTER TYPE "OrderStatus" RENAME VALUE 'IN_PROGRESS' TO 'ON_DELIVERY';
