ALTER TABLE "orders" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "idempotency_fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_customer_id_idempotency_key_unique" ON "orders" USING btree ("customer_id","idempotency_key") WHERE "orders"."idempotency_key" is not null;