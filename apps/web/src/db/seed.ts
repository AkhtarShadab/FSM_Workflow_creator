import { db } from "./index";
import { projects } from "./schema";

async function seed() {
  const existing = await db.select().from(projects).limit(1);
  if (existing.length > 0) {
    console.log("Database already seeded.");
    return;
  }

  await db.insert(projects).values([
    { name: "Web Scrape + Summarize" },
    { name: "Code Review Agent" },
    { name: "ETL Pipeline" },
  ]);

  console.log("Seeded 3 sample projects.");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
