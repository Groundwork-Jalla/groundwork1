/**
 * Which sections live on which step.
 *
 * Contractors told us the form was too long. Nothing here changes what is asked — same
 * fields, same rules — only how much of it a person faces at once. Sections keep their
 * original order so the grouping needs no explaining, and the two heavy ones get a step
 * to themselves: credentials and project history each send someone away to find a
 * document or a phone number, and that is where an application gets abandoned.
 */
export const STEPS: ReadonlyArray<{ key: string; sections: number[] }> = [
  { key: 'identity',    sections: [1, 2] },
  { key: 'experience',  sections: [3] },
  { key: 'standards',   sections: [6, 7] },
  { key: 'capacity',    sections: [8] },
  { key: 'projects',    sections: [5] },
  { key: 'credentials', sections: [4, 9] },
];

/**
 * Note the order: sections are NOT in numeric order, and that is the point.
 *
 * The two heaviest asks are last — three project references, then the documents — because
 * both send someone away from the screen to find a phone number or a scan, and that is
 * where an application is abandoned. Asked first, they are a wall in front of a stranger.
 * Asked at step five of six, they are the last stretch of something already most of the
 * way done, and the answers to everything else are already saved.
 *
 * Sections render in file order within a step, so the last step reads uploads then the
 * agreement, which is the right order for a page that ends in the submit button.
 */

