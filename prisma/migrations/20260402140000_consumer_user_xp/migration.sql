-- AlterTable
ALTER TABLE "User" ADD COLUMN "dobby_xp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "order_streak_days" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "last_order_streak_date" DATE;

-- CreateTable
CREATE TABLE "UserXpLedger" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "order_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserXpLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserXpLedger_idempotency_key_key" ON "UserXpLedger"("idempotency_key");
CREATE INDEX "UserXpLedger_user_id_created_at_idx" ON "UserXpLedger"("user_id", "created_at");

ALTER TABLE "UserXpLedger" ADD CONSTRAINT "UserXpLedger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
