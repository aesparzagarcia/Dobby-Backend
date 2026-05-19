-- CreateEnum
CREATE TYPE "AppConfigType" AS ENUM ('DOUBLE', 'BOOLEAN', 'STRING');

-- CreateTable
CREATE TABLE "app_config" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" "AppConfigType" NOT NULL,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_config_key_key" ON "app_config"("key");

-- Seed delivery pricing defaults
INSERT INTO "app_config" ("id", "key", "value", "type") VALUES
(1, 'BASE_FEE', '25.0', 'DOUBLE'),
(2, 'PRICE_PER_KM', '7.0', 'DOUBLE'),
(3, 'WEATHER_FEE', '15.0', 'DOUBLE'),
(4, 'DEFAULT_DEMAND_MULTIPLIER', '1.0', 'DOUBLE'),
(5, 'DEFAULT_IS_RAINING', 'false', 'BOOLEAN'),
(6, 'ZONE_A_MAX_KM', '3.0', 'DOUBLE'),
(7, 'ZONE_B_MAX_KM', '7.0', 'DOUBLE'),
(8, 'ZONE_C_MAX_KM', '12.0', 'DOUBLE'),
(9, 'ZONE_B_FEE', '10.0', 'DOUBLE'),
(10, 'ZONE_C_FEE', '25.0', 'DOUBLE'),
(11, 'ZONE_D_FEE', '50.0', 'DOUBLE');

SELECT setval(pg_get_serial_sequence('app_config', 'id'), (SELECT MAX(id) FROM app_config));
