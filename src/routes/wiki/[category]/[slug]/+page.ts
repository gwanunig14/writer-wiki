import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, params }) => {
  const response = await fetch(`/api/wiki/${params.category}/${params.slug}`);
  if (!response.ok) {
    throw error(response.status, "Wiki page not found.");
  }

  return {
    page: await response.json(),
  };
};
