import { json } from "@sveltejs/kit";
import { getWikiTree } from "$lib/server/db/repositories/wiki-repository";

export async function GET() {
  return json({ nodes: getWikiTree() });
}
