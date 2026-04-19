import type { PageLoad } from "./$types";
import type { WikiPage } from "$lib/types/domain";

const emptyChronologyPage: WikiPage = {
  title: "Chronology",
  kind: "chronology",
  category: "chronology",
  body: "These files do not exist yet. Please provide more chapters.",
  backlinks: [],
};

export const load: PageLoad = async ({ fetch }) => {
  const response = await fetch("/api/wiki/chronology/chronology");
  if (!response.ok) {
    return {
      page: emptyChronologyPage,
    };
  }

  return {
    page: await response.json(),
  };
};
