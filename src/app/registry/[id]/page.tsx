import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SpecimenDetail } from "@/components/SpecimenDetail";
import { getOrigin } from "@/lib/db/repository";
import { getSql } from "@/lib/db/sql";
import { ensureSchema } from "@/lib/db/schema";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;

  try {
    const sql = await getSql();
    await ensureSchema(sql);
    const session = await getSession();
    const origin = await getOrigin(session.sessionId, id);

    if (!origin) return { title: "Specimen not found" };

    return {
      title: `${origin.name}${origin.symbol ? ` (${origin.symbol})` : ""}`,
      description: origin.description
        ? origin.description.slice(0, 160)
        : `Origin dossier for ${origin.name} on Solana mint ${origin.mint}.`,
    };
  } catch {
    return { title: "Specimen" };
  }
}

export default async function SpecimenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sql = await getSql();
  await ensureSchema(sql);
  const session = await getSession();
  const origin = await getOrigin(session.sessionId, id);

  // A record in another session is indistinguishable from a missing one, so
  // this 404 is also the cross-session protection.
  if (!origin) notFound();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <SpecimenDetail initialOrigin={origin} />
    </div>
  );
}