ALTER TYPE "public"."notification_status" ADD VALUE 'logged';--> statement-breakpoint
ALTER TABLE "notifications_log" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "notifications_log" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications_log" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications_log" ADD CONSTRAINT "notifications_log_dedupe_key_unique" UNIQUE("dedupe_key");