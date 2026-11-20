-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "discount_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "promo_code" TEXT;

-- CreateTable
CREATE TABLE "promo_codes" (
    "code" TEXT NOT NULL,
    "percent_off" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("code")
);

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_promo_code_fkey" FOREIGN KEY ("promo_code") REFERENCES "promo_codes"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Ajouts manuels (non exprimables dans schema.prisma). Voir DECISIONS.md D11.
-- ---------------------------------------------------------------------------
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_code_check"        CHECK ("code" ~ '^[A-Z0-9]{3,20}$');
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_percent_off_check" CHECK ("percent_off" BETWEEN 1 AND 100);
ALTER TABLE "orders"      ADD CONSTRAINT "orders_discount_cents_check"   CHECK ("discount_cents" >= 0);
-- Pas de remise sans code : le prix payé doit toujours s'expliquer.
ALTER TABLE "orders"      ADD CONSTRAINT "orders_promo_discount_check"   CHECK ("promo_code" IS NOT NULL OR "discount_cents" = 0);
