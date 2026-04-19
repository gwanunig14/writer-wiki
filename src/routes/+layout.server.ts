import type { LayoutServerLoad } from "./$types";
import { getWikiTree } from "$lib/server/db/repositories/wiki-repository";

export const load: LayoutServerLoad = ({ locals, depends }) => {
  depends("app:shell");

  return {
    projectState: locals.projectState,
    navigation: locals.projectState.ready ? getWikiTree() : [],
  };
};
