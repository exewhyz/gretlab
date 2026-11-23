CREATE TABLE "job_rows" (
	"job_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"count" integer NOT NULL,
	"data" text NOT NULL,
	CONSTRAINT "job_rows_job_id_seq_pk" PRIMARY KEY("job_id","seq")
);
--> statement-breakpoint
ALTER TABLE "job_rows" ADD CONSTRAINT "job_rows_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;