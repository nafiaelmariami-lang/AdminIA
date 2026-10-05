CREATE TABLE "reminder_log" (
	"task_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_log_task_id_kind_pk" PRIMARY KEY("task_id","kind")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reminder_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "calendar_token_hash" text;--> statement-breakpoint
ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_calendar_token_unique" ON "users" USING btree ("calendar_token_hash");