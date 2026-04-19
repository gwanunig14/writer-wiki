import type { PageLoad } from "./$types";
import type { WikiPage } from "$lib/types/domain";

const emptyContinuityPage: WikiPage = {
  title: "Continuity Watchlist",
  kind: "continuity",
  category: "continuity",
  body: "These files do not exist yet. Please provide more chapters.",
  backlinks: [],
};

export const load: PageLoad = async ({ fetch }) => {
  const response = await fetch("/api/wiki/continuity/continuity-watchlist");
  if (!response.ok) {
    return {
      page: emptyContinuityPage,
    };
  }

  return {
    page: await response.json(),
  };
};
