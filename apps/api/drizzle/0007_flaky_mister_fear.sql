CREATE TYPE "public"."phone_verification_kind" AS ENUM('start', 'check');--> statement-breakpoint
CREATE TABLE "customer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	CONSTRAINT "customer_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "phone_verification_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"ip" text,
	"kind" "phone_verification_kind" NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "customers_email_unique";--> statement-breakpoint
DROP INDEX "customers_phone_idx";--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
DO $$
DECLARE
  null_phones integer;
BEGIN
  SELECT count(*) INTO null_phones FROM "customers" WHERE "phone" IS NULL;

  IF null_phones > 0 THEN
    RAISE NOTICE 'customers.phone left nullable: % existing rows have NULL phone; no placeholder data was created.', null_phones;
  ELSE
    ALTER TABLE "customers" ALTER COLUMN "phone" SET NOT NULL;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_sessions_customer_id_idx" ON "customer_sessions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_sessions_expires_at_idx" ON "customer_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "phone_verification_attempts_phone_created_idx" ON "phone_verification_attempts" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "phone_verification_attempts_ip_created_idx" ON "phone_verification_attempts" USING btree ("ip","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_phone_unique" ON "customers" USING btree ("phone") WHERE "customers"."phone" is not null;--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree ("email");--> statement-breakpoint
ALTER TABLE "customer_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "phone_verification_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "customer_sessions" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON "phone_verification_attempts" FROM anon, authenticated;