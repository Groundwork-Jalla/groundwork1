/**
 * Which sections live on which step.
 *
 * Contractors told us the form was too long. Nothing here changes what is asked — same
 * fields, same rules — only how much of it a person faces at once.
 *
 * **One section per step.** An earlier version paired them up into six steps, which still
 * put eight fields on the first screen and read as a shorter version of the same wall.
 * One titled section at a time is the whole point: a person sees a question, answers it,
 * and moves on, without the rest of the form visible to be daunted by.
 *
 * The single exception is the last step, which carries the documents *and* the agreement.
 * The agreement is one checkbox that belongs directly above the submit button; giving it
 * a screen of its own would be a page containing nothing but a tickbox.
 */
export const STEPS: ReadonlyArray<{ key: string; sections: number[] }> = [
  { key: 'identity',    sections: [1] },
  { key: 'category',    sections: [2] },
  { key: 'experience',  sections: [3] },
  { key: 'standards',   sections: [6] },
  { key: 'alignment',   sections: [7] },
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
 * Asked at step seven of eight, they are the last stretch of something already most of
 * the way done, and the answers to everything else are already saved.
 *
 * Sections render in file order within a step, so the last step reads uploads then the
 * agreement, which is the right order for a page that ends in the submit button.
 */

