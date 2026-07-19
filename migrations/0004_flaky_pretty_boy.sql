CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
ALTER TABLE "accepted_generated_tests" ADD COLUMN "spec_hash" text;--> statement-breakpoint
UPDATE "accepted_generated_tests"
SET "spec_hash" = encode(digest("spec_source", 'sha256'), 'hex');--> statement-breakpoint
DELETE FROM "accepted_generated_tests" AS "candidate"
USING "accepted_generated_tests" AS "keeper"
WHERE "candidate"."project_id" = "keeper"."project_id"
  AND "candidate"."spec_hash" = "keeper"."spec_hash"
  AND (
    "candidate"."created_at" > "keeper"."created_at"
    OR (
      "candidate"."created_at" = "keeper"."created_at"
      AND "candidate"."id"::text > "keeper"."id"::text
    )
  );--> statement-breakpoint
ALTER TABLE "accepted_generated_tests" ALTER COLUMN "spec_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accepted_generated_tests" ADD CONSTRAINT "accepted_generated_tests_project_spec_hash_unique" UNIQUE("project_id","spec_hash");
