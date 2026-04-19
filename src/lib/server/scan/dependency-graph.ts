import { listChapters } from "$lib/server/db/repositories/chapter-repository";

export function getLaterAffectedChapterIds(sourceChapterId: string) {
  const chapters = listChapters();
  const source = chapters.find((chapter) => chapter.id === sourceChapterId);
  if (!source) {
    return [];
  }

  return chapters
    .filter((chapter) => chapter.id !== sourceChapterId)
    .filter((chapter) => {
      if (source.number !== null && chapter.number !== null) {
        return chapter.number > source.number;
      }

      return chapter.createdAt > source.createdAt;
    })
    .map((chapter) => chapter.id);
}
