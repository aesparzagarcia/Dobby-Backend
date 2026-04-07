ALTER TABLE "Product"
ADD COLUMN "has_promotion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "discount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Product"
ADD CONSTRAINT "Product_discount_range_check" CHECK ("discount" >= 0 AND "discount" <= 100);
