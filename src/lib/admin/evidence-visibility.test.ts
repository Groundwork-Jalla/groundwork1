import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Evidence is reachable by the people it was uploaded for.
 *
 * Reported together: the client could see that seven photographs existed on a substage
 * and could not open one; and neither client nor contractor could find evidence in the
 * Documents view at all, because documents and evidence are two tables in two buckets
 * and only the first was ever read there.
 *
 * They stay separate — "general project documents should remain separate from
 * stage-specific evidence uploads" — so this is two sections side by side, never a
 * merged list.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const row    = read('src/components/project/SubstageRow.tsx');
const lib    = read('src/lib/supabase/documents.ts');
const client = read('src/app/routes/projects/detail.tsx');
const work   = read('src/app/routes/work/projects.detail.tsx');

describe('evidence opens INSIDE Groundwork, never as a download', () => {
  const box = read('src/components/project/EvidenceLightbox.tsx');

  it('the chip opens a viewer, not a new tab', () => {
    /**
     * A signed URL in a tab hands the browser a bare file: Chrome renders a PDF in its
     * own viewer with a download button, an image is one right-click from the desktop,
     * and the URL sits in the address bar where it can be copied and forwarded for the
     * hour it lives.
     */
    // The chip is a tile now and the viewer lives with it, in EvidenceThumbs.
    const thumbs = read('src/components/project/EvidenceThumbs.tsx');
    expect(row).toMatch(/<EvidenceThumbs paths=\{urls\} \/>/);
    expect(thumbs).toMatch(/<EvidenceLightbox items=\{items\}/);
    expect(row).not.toMatch(/window\.open/);
    expect(thumbs).not.toMatch(/window\.open/);
  });

  it('and nothing in the evidence path opens a tab any more', () => {
    // The thumbnails and the viewer are the whole path now; StageEvidenceList is gone.
    const thumbs = read('src/components/project/EvidenceThumbs.tsx');
    expect(thumbs).not.toMatch(/window\.open/);
    expect(read('src/components/project/EvidenceLightbox.tsx')).not.toMatch(/window\.open/);
  });

  it('the easy ways out are closed', () => {
    // Friction, not protection — see the limits test below.
    expect(box).toMatch(/onContextMenu=\{e => e\.preventDefault\(\)\}/);
    expect(box).toMatch(/onDragStart=\{e => e\.preventDefault\(\)\}/);
    expect(box).toMatch(/controlsList="nodownload/);
    expect(box).toMatch(/toolbar=0/);
  });

  it('and it is honest in the code about what it cannot do', () => {
    // A screenshot is handled by the OS before any JavaScript runs. Claiming otherwise
    // would have somebody promise a client their photographs cannot leave.
    expect(box).toMatch(/CANNOT stop a screenshot/);
  });
});

describe('the viewer behaves like the photo viewers people already use', () => {
  const box = read('src/components/project/EvidenceLightbox.tsx');

  it('arrows, and a swipe on a phone', () => {
    expect(box).toMatch(/onTouchStart/);
    expect(box).toMatch(/Math\.abs\(dx\) > 50/);
    expect(box).toMatch(/ArrowRight/);
    expect(box).toMatch(/ArrowLeft/);
  });

  it('Escape closes it, and the page behind does not scroll', () => {
    expect(box).toMatch(/e\.key === 'Escape'/);
    expect(box).toMatch(/document\.body\.style\.overflow = 'hidden'/);
  });

  it('it wraps rather than dead-ending at the last photograph', () => {
    expect(box).toMatch(/\(index \+ delta \+ items\.length\) % items\.length/);
  });

  it('video is played, not downloaded', () => {
    expect(box).toMatch(/const VIDEO = /);
    expect(box).toMatch(/<video/);
  });

  it('and one URL is signed at a time, for the file being looked at', () => {
    // Twenty photographs would otherwise mint twenty hour-long capabilities nobody opens.
    expect(box).toMatch(/signedUrlIn\(item\.bucket \?\? 'evidence', item\.path\)/);
  });
});

describe('the Documents view is documents only', () => {
  const docsPage = read('src/app/routes/documents.tsx');

  it('evidence is not rebuilt in the project Documents tab', () => {
    /**
     * It was, briefly, and that was the redundancy: a second copy of the stage tracker
     * sitting under Documents. Evidence belongs with the stage it is about, where it
     * means something; a person looking for a permit should not scroll past forty
     * photographs of a slab.
     */
    expect(client).not.toMatch(/StageEvidenceList/);
    expect(work).not.toMatch(/StageEvidenceList/);
  });

  it('and the central page has no Evidence tab', () => {
    expect(docsPage).toMatch(/type Tab = 'documents' \| 'certificates';/);
    expect(docsPage).not.toMatch(/tab === 'evidence'/);
  });

  it('it lists real documents instead', () => {
    expect(docsPage).toMatch(/from\('project_documents'\)/);
  });
});

describe('documents can be found without scrolling', () => {
  const docsPage = read('src/app/routes/documents.tsx');

  it('search matches the name, the project and the category', () => {
    // "The Kribi permit" and "everything on Franka Home" are the two real questions.
    expect(docsPage).toMatch(/d\.file_name\.toLowerCase\(\)\.includes\(q\)/);
    expect(docsPage).toMatch(/projectName\(d\.project_id\)\.toLowerCase\(\)\.includes\(q\)/);
    expect(docsPage).toMatch(/String\(d\.category \?\? ''\)\.toLowerCase\(\)\.includes\(q\)/);
  });

  it('and there is a project filter once there is more than one build', () => {
    expect(docsPage).toMatch(/projects\.length > 1 && \(/);
    expect(docsPage).toMatch(/documents\.allProjects/);
  });

  it('"nothing matches" and "nothing here" are different messages', () => {
    // Showing the wrong one sends somebody looking for a bug that is not there.
    expect(docsPage).toMatch(/docs\.length === 0 \? t\('documents\.noDocuments'\) : t\('documents\.noMatches'\)/);
  });

  it('and a document opens in the viewer, not as a download', () => {
    expect(docsPage).toMatch(/<EvidenceLightbox/);
    expect(docsPage).not.toMatch(/window\.open/);
  });
});

describe('the loader reads both sources without conflating them', () => {
  it('documents and substage evidence, each tagged with its bucket', () => {
    expect(lib).toMatch(/export async function listProjectFiles/);
    expect(lib).toMatch(/bucket: 'documents'/);
    expect(lib).toMatch(/bucket: 'evidence'/);
  });

  it('the signed-URL helper takes the bucket, because evidence is not in documents', () => {
    // `getSignedDocumentUrl` hardcodes 'documents', which is right for the vault and
    // wrong for evidence.
    expect(lib).toMatch(/export async function signedUrlIn\(\s*bucket: 'documents' \| 'evidence', path: string,/);
  });

  it('an evidence key is the path, not the index', () => {
    // A substage's array is reordered when one is removed; an index key would re-mount
    // every row after it.
    expect(lib).toMatch(/key: `ev:\$\{String\(s\.id\)\}:\$\{p\}`/);
  });

  it('and the three queries are not one per stage', () => {
    expect(lib).toMatch(/Promise\.all\(\[/);
  });
});

describe('evidence reads as tiles, not as a list of labels', () => {
  const thumbs = read('src/components/project/EvidenceThumbs.tsx');

  it('no "Photo 1 / File 2" pills', () => {
    // They carried no information: nobody is looking for photo 4, they are looking for
    // the one with the rebar in it.
    expect(read('src/components/project/SubstageRow.tsx')).not.toMatch(/project\.stages\.photoN/);
    expect(thumbs).not.toMatch(/photoN|fileN/);
  });

  it('a real thumbnail, at a size you can see', () => {
    expect(thumbs).toMatch(/size-16/);
    expect(thumbs).toMatch(/object-cover/);
  });

  it('the label is the file\'s own name, not an index', () => {
    expect(thumbs).toMatch(/\(p\.split\('\/'\)\.pop\(\) \?\? p\)\.replace\(\/\^\\d\+_\/, ''\)/);
  });

  it('a resized image is requested, with a fallback when transforms are off', () => {
    // A grid of full-size photographs is several megabytes over a site connection.
    expect(thumbs).toMatch(/\{ width: 160, height: 160 \}/);
    expect(thumbs).toMatch(/onError=/);
    expect(thumbs).toMatch(/el\.dataset\.full/);
  });

  it('and video and documents get a tile too, rather than a blank square', () => {
    expect(thumbs).toMatch(/<Play /);
    expect(thumbs).toMatch(/<FileText /);
  });
});
