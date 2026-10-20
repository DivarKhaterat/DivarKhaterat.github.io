CREATE TABLE "comments" (
	"id" text PRIMARY KEY,
	"memory_id" text NOT NULL,
	"name" text NOT NULL,
	"text" text NOT NULL,
	"ts" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hits" (
	"id" serial PRIMARY KEY,
	"key" text NOT NULL,
	"ts" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "likes" (
	"memory_id" text,
	"cid" text,
	CONSTRAINT "likes_pkey" PRIMARY KEY("memory_id","cid")
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" text PRIMARY KEY,
	"emotion" text NOT NULL,
	"text" text NOT NULL,
	"anon" boolean DEFAULT false NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"avatar" text DEFAULT '' NOT NULL,
	"ts" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "comments_memory_idx" ON "comments" ("memory_id");--> statement-breakpoint
CREATE INDEX "hits_key_ts_idx" ON "hits" ("key","ts");--> statement-breakpoint
CREATE INDEX "memories_ts_idx" ON "memories" ("ts");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_memory_id_memories_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_memory_id_memories_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE;