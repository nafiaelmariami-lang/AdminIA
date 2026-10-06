CREATE TABLE "admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid,
	"admin_email" text NOT NULL,
	"action" text NOT NULL,
	"target_user_id" uuid,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit" USING btree ("created_at");