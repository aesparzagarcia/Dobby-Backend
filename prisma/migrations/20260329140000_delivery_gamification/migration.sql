-- AlterTable
ALTER TABLE "DeliveryMan" ADD COLUMN     "xp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryMan" ADD COLUMN     "rating" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryMan" ADD COLUMN     "rating_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryMan" ADD COLUMN     "total_deliveries" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryMan" ADD COLUMN     "current_streak_days" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryMan" ADD COLUMN     "last_streak_date" DATE;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "on_delivery_started_at" TIMESTAMP(3),
ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "delivery_rating" INTEGER;

-- CreateIndex
CREATE INDEX "Order_delivery_man_id_delivered_at_idx" ON "Order"("delivery_man_id", "delivered_at");
