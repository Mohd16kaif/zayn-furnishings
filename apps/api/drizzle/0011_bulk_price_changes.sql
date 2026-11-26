CREATE TABLE "price_change_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"params" jsonb NOT NULL,
	"item_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by_admin_user_id" uuid,
	CONSTRAINT "price_change_batches_item_count_positive" CHECK ("price_change_batches"."item_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "price_change_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"old_price_cents" integer NOT NULL,
	"old_sale_price_cents" integer,
	"new_price_cents" integer NOT NULL,
	"new_sale_price_cents" integer,
	CONSTRAINT "price_change_items_prices_non_negative" CHECK ("price_change_items"."old_price_cents" >= 0 and "price_change_items"."new_price_cents" >= 0),
	CONSTRAINT "price_change_items_old_sale_less_than_price" CHECK ("price_change_items"."old_sale_price_cents" is null or "price_change_items"."old_sale_price_cents" < "price_change_items"."old_price_cents"),
	CONSTRAINT "price_change_items_new_sale_less_than_price" CHECK ("price_change_items"."new_sale_price_cents" is null or "price_change_items"."new_sale_price_cents" < "price_change_items"."new_price_cents")
);
--> statement-breakpoint
ALTER TABLE "price_change_batches" ADD CONSTRAINT "price_change_batches_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_change_batches" ADD CONSTRAINT "price_change_batches_undone_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("undone_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_change_items" ADD CONSTRAINT "price_change_items_batch_id_price_change_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."price_change_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_change_items" ADD CONSTRAINT "price_change_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_change_batches_admin_user_id_idx" ON "price_change_batches" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "price_change_batches_created_at_idx" ON "price_change_batches" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "price_change_items_batch_id_idx" ON "price_change_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "price_change_items_product_id_idx" ON "price_change_items" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "price_change_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "price_change_items" ENABLE ROW LEVEL SECURITY;