CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_status" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "billing_interval" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "billing_event_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_billing_customer_unique" ON "users" USING btree ("billing_customer_id");