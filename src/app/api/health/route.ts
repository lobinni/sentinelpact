import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!db) {
    // Databaseless deployment (e.g. Vercel): the app itself is fully on-chain.
    return Response.json({ ok: true, db: "not_configured" });
  }
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
