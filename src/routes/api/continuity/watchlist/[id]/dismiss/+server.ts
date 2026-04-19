import { error, json } from "@sveltejs/kit";
import { dismissWatchlistEntry } from "$lib/server/canon/continuity-manager";

export async function POST({ params }) {
  try {
    return json(dismissWatchlistEntry(params.id));
  } catch (caughtError) {
    throw error(
      404,
      caughtError instanceof Error
        ? caughtError.message
        : "Continuity watchlist item not found.",
    );
  }
}
