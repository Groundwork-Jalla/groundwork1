// =========================================================
// "What stage is this build on?" — in the contractor's words, not ours.
//
// A partner contractor bringing a client whose build is already half up does not know
// Groundwork's ten stages. They will say "we're at finishing", "roof is on", "casting the
// decking next week", or "nous coulons la dalle". This turns that into a stage number.
//
// ── It proposes; a human confirms ────────────────────────────────────────────────────
// Nothing here starts a project. The admin is always shown which stage was matched and on
// what evidence, and can override it. That is not timidity: the consequence of guessing
// wrong is a real stage marked complete that nobody built, or a client asked to pay again
// for work they finished last year. A confident-looking wrong answer is the expensive
// failure mode, so `confidence` is part of the result and `none` is a legitimate answer.
//
// ── Why keywords and not a model ─────────────────────────────────────────────────────
// The vocabulary is small, closed and known: ten stage names and about sixty substage
// names, in two languages. A contractor saying "plumbing" means exactly one of our stages.
// A language model would be slower, need a network round trip during onboarding, cost
// money per project, and — the real objection — would not be able to tell the admin WHY it
// chose a stage. `matched` below is the phrase it recognised, so the admin can see the
// reasoning and disagree with it.
//
// ── Fail closed on ambiguity; never "later is safer" ─────────────────────────────────
// An earlier draft took the FURTHEST stage a description mentioned, on the theory that
// starting too late is cheaper than starting too early. That theory is wrong, and it is wrong
// in a financially consequential place. Consider:
//
//     "Foundation is complete; roofing materials are already ordered."
//     "Finishing plumbing before we start painting."
//
// Both name a later stage that has NOT been built. Taking it would mark every stage below it
// pre-existing — skipping the verification and the billing for real, unbuilt work. That is as
// material an error as overbilling, just in the other direction.
//
// So a later stage wins only when the LANGUAGE says it is the current position: "starting",
// "now on", "we are at", "next is X" (which places them before X). A bare mention of a later
// stage does not outrank a clear statement about an earlier one — when two stages are named
// and nothing distinguishes which is current, the answer is `ambiguous` and the admin chooses.
//
// The classifier is an assistant, never the authority.
// =========================================================

/** Groundwork's ten stages, by number. Keys match `stage-seeds.ts`. */
export const STAGE_KEYS = [
  'landSecured', 'designCompleted', 'sitePreparation', 'foundation', 'structureWalls',
  'roofing', 'electricalPlumbing', 'finishing', 'exteriorWork', 'finalHandover',
] as const;

export type StageKey = typeof STAGE_KEYS[number];

/** 1-based, matching `project_stages.stage_number`. */
export const stageNumberOf = (key: StageKey): number => STAGE_KEYS.indexOf(key) + 1;

export type Confidence =
  | 'high'
  | 'medium'
  /**
   * Several stages named and nothing says which is current. NOT a proposal: the caller must
   * make the admin choose. `stageNumber` is null.
   */
  | 'ambiguous'
  | 'none';

export interface StageGuess {
  /** 1–10, or null when nothing was recognised. */
  stageNumber: number | null;
  stageKey: StageKey | null;
  confidence: Confidence;
  /** The phrase that decided it — shown to the admin so they can disagree. */
  matched: string | null;
  /** Other stages the text also pointed at, latest first. Shown as alternatives. */
  alsoMatched: { stageNumber: number; matched: string }[];
}

/**
 * Phrases that name a stage.
 *
 * `strong` is unmistakable: the stage's own name, or a substage that exists in exactly one
 * stage. `weak` is a word that appears in the right area but also elsewhere — it counts,
 * but only lifts confidence to medium.
 *
 * French sits beside English rather than in a separate table: a Cameroonian contractor
 * mixes the two in one sentence, and splitting them would mean matching twice and merging.
 */
const PHRASES: Record<StageKey, { strong: string[]; weak: string[] }> = {
  landSecured: {
    strong: [
      'land secured', 'land title', 'land certificate', 'title deed', 'bought the land',
      'buying the land', 'land purchase', 'land search', 'notary', 'surveyor',
      'terrain acquis', 'titre foncier', 'achat du terrain', 'notaire', 'géomètre',
    ],
    weak: ['land', 'plot', 'terrain'],
  },
  designCompleted: {
    strong: [
      'design', 'architectural plan', 'architect', 'structural plan', 'soil test',
      'building permit', 'permit application', 'plan authorization', 'plan authorisation',
      'conception', 'plan architectural', 'architecte', 'permis de construire',
      'étude de sol', 'plan de structure',
    ],
    weak: ['plan', 'plans', 'drawing', 'drawings'],
  },
  sitePreparation: {
    strong: [
      'site preparation', 'site prep', 'clearing and leveling', 'clearing and levelling',
      'clearing', 'leveling', 'levelling', 'borehole', 'water supply connection',
      'energy supply', 'electricity supply', 'meter application', 'magazine construction',
      'block molding', 'block moulding', 'site materials', 'tools procurement',
      'préparation du site', 'débroussaillage', 'nivellement', 'forage',
      'raccordement', 'branchement',
    ],
    weak: ['site', 'fencing the site', 'temporary'],
  },
  foundation: {
    strong: [
      'foundation', 'excavation', 'pits and trenches', 'trenches', 'lean concrete',
      'footing', 'footings', 'reinforced concrete footings', 'foundation pillars',
      'foundation beams', 'backfill', 'backfilling', 'ground floor casting',
      'pre-ground floor casting', 'polystyrene', 'blinding',
      'fondation', 'fondations', 'excavation', 'semelle', 'semelles', 'béton de propreté',
      'remblai', 'remblayage', 'longrine',
    ],
    weak: ['digging', 'dig', 'fouille'],
  },
  structureWalls: {
    strong: [
      'structure', 'walls', 'block walls', 'blockwork', 'pillars', 'columns',
      'beams and lintels', 'lintels', 'staircase', 'floor slab', 'decking', 'deck slab',
      'casting the slab', 'slab casting', 'first floor', 'second floor', 'suspended slab',
      'structure et murs', 'murs', 'maçonnerie', 'poteaux', 'poutres', 'linteaux',
      'escalier', 'dalle', 'coulage de la dalle', 'agglos',
    ],
    weak: ['blocks', 'building up', 'walling', 'concrete'],
  },
  roofing: {
    strong: [
      'roofing', 'roof', 'truss', 'trusses', 'hardwood truss', 'purlin', 'purlins',
      'roofing sheet', 'roofing sheets', 'aluminium roof', 'aluminum roof', 'clay tile',
      'parapet', 'gutter', 'gutters', 'waterproofing', 'formwork',
      'toiture', 'toit', 'charpente', 'pannes', 'tôles', 'tôle', 'gouttière',
      'étanchéité', 'coffrage',
    ],
    weak: ['sheets', 'covering'],
  },
  electricalPlumbing: {
    strong: [
      'electrical', 'electricity', 'plumbing', 'conduit', 'cabling', 'wiring',
      'switches', 'sockets', 'junction box', 'junction boxes', 'lighting fixtures',
      'chandelier', 'meter installation', 'water supply system', 'drainage',
      'sanitary', 'sanitary fixtures', 'kitchen sink', 'septic tank', 'soak away',
      'soak-away', 'soakaway', 'mep',
      'électricité', 'electricite', 'plomberie', 'câblage', 'gaines',
      'interrupteurs', 'prises', 'luminaires', 'assainissement', 'fosse septique',
      'sanitaire', 'sanitaires',
    ],
    weak: ['pipes', 'tuyaux', 'electric'],
  },
  finishing: {
    strong: [
      'finishing', 'finishes', 'plastering', 'internal plastering', 'external plastering',
      'rendering', 'screed', 'mortar flooring', 'wall tiles', 'wall tiling', 'tiling',
      'tiles', 'decorative plaster', 'wooden doors', 'doors', 'aluminium windows',
      'glass windows', 'windows', 'iron railings', 'railings', 'painting', 'paint',
      'internal paint', 'external paint', 'ceiling', 'varnish',
      'finition', 'finitions', 'enduit', 'crépissage', 'carrelage', 'carreaux',
      'peinture', 'portes', 'fenêtres', 'plafond', 'vernis',
    ],
    weak: ['fitting out', 'second fix'],
  },
  exteriorWork: {
    strong: [
      'exterior work', 'external work', 'exterior lighting', 'water feature',
      'water features', 'exterior flooring', 'fence', 'fencing', 'perimeter wall',
      'garden', 'landscaping', 'seating', 'paving', 'driveway',
      'travaux extérieurs', 'extérieur', 'clôture', 'jardin',
      'aménagement extérieur', 'pavé',
    ],
    weak: ['outside', 'compound'],
  },
  finalHandover: {
    // NO generic completion words here. 'completed', 'done', 'finished', 'terminé' describe
    // whatever stage the sentence is about — "design completed", "fondations terminées" — and
    // with the bias-late rule they would drag every such description to stage 10 and mark a
    // whole house built. Only phrases meaning THE HANDOVER ITSELF belong in this list.
    strong: [
      'final handover', 'handover', 'hand over', 'handing over', 'final inspection',
      'full system inspection', 'keys', 'practical completion', 'snagging',
      'ready to move in', 'moving in', 'ready for occupation',
      'réception des travaux', 'remise des cles', 'remise des clés', 'livraison',
    ],
    weak: [],
  },
};

/**
 * An explicit stage number, when the contractor uses ours.
 *
 * Some partners will have read the documentation and say "stage 5". Taken at face value —
 * they are naming our scale, not describing work, so there is nothing to interpret.
 */
// Matched against the NORMALISED text, not the raw input: `\b` is defined on [A-Za-z0-9_],
// so it never anchors before the `é` of "étape" and that spelling would never match. After
// normalisation the accent is gone and the boundary works.
const EXPLICIT = /\b(?:stage|phase|etape)\s*(?:number\s*)?([1-9]|10)\b/;

/** Lowercase, strip accents, collapse punctuation to single spaces. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Accent-stripped too, so a phrase table entry with é matches text typed without it. */
const prepared = (() => {
  const out = new Map<StageKey, { strong: string[]; weak: string[] }>();
  for (const key of STAGE_KEYS) {
    out.set(key, {
      strong: PHRASES[key].strong.map(normalise),
      weak:   PHRASES[key].weak.map(normalise),
    });
  }
  return out;
})();

/**
 * Whole-phrase match on a normalised haystack.
 *
 * Padded with spaces so `land` cannot match inside `island` and `paint` cannot match
 * inside `painting` — which would be harmless here, but `done` inside `abandoned` would
 * not be.
 */
const contains = (haystack: string, needle: string): boolean =>
  ` ${haystack} `.includes(` ${needle} `);

/**
 * Which stage a description is talking about.
 *
 * Returns `confidence: 'none'` and a null stage rather than a guess when nothing matches.
 * The caller must handle that by asking the admin to choose — never by defaulting to
 * stage 1, which would silently restart somebody's half-built house.
 */
export function stageFromDescription(description: string): StageGuess {
  const empty: StageGuess = {
    stageNumber: null, stageKey: null, confidence: 'none', matched: null, alsoMatched: [],
  };

  const raw = (description ?? '').trim();
  if (!raw) return empty;

  const text = normalise(raw);
  if (!text) return empty;

  // Our own numbering, used deliberately. Checked first: a partner who says "stage 5" is
  // naming our scale, so there is nothing to interpret from the surrounding words.
  const explicit = text.match(EXPLICIT);
  if (explicit) {
    const n = Number(explicit[1]);
    if (n >= 1 && n <= STAGE_KEYS.length) {
      return {
        stageNumber: n, stageKey: STAGE_KEYS[n - 1],
        confidence: 'high', matched: explicit[0].trim(), alsoMatched: [],
      };
    }
  }

  const hits: { stageNumber: number; key: StageKey; strong: boolean; matched: string }[] = [];

  for (const key of STAGE_KEYS) {
    const table = prepared.get(key)!;
    // Longest phrase first, so "ground floor casting" is reported rather than "casting".
    const strong = [...table.strong].sort((a, b) => b.length - a.length).find(p => contains(text, p));
    if (strong) {
      hits.push({ stageNumber: stageNumberOf(key), key, strong: true, matched: strong });
      continue;
    }
    const weak = [...table.weak].sort((a, b) => b.length - a.length).find(p => contains(text, p));
    if (weak) hits.push({ stageNumber: stageNumberOf(key), key, strong: false, matched: weak });
  }

  if (hits.length === 0) return empty;

  const strongHits = hits.filter(h => h.strong);
  const pool = strongHits.length > 0 ? strongHits : hits;

  // Distinct stages actually named. Two phrases from the same stage are not a conflict.
  const distinct = [...new Set(pool.map(h => h.stageNumber))];

  const others = (chosen: number) => hits
    .filter(h => h.stageNumber !== chosen)
    .sort((a, b) => a.stageNumber - b.stageNumber)
    .map(h => ({ stageNumber: h.stageNumber, matched: h.matched }));

  // One stage named: no conflict to resolve — unless the sentence says that stage has NOT
  // started ("casting the slab next week"), in which case proposing it would mark everything
  // below it built on the strength of a plan.
  if (distinct.length === 1) {
    const best = pool.find(h => h.stageNumber === distinct[0])!;
    if (currentCue(text, best.matched) === 'not_yet') {
      return {
        stageNumber: null, stageKey: null, confidence: 'ambiguous', matched: null,
        alsoMatched: [{ stageNumber: best.stageNumber, matched: best.matched }],
      };
    }
    return {
      stageNumber: best.stageNumber,
      stageKey: best.key,
      // A weak-only match is never high confidence: "concrete" appears in four stages.
      confidence: best.strong ? 'high' : 'medium',
      matched: best.matched,
      alsoMatched: others(best.stageNumber),
    };
  }

  // Several stages named. Only an explicit statement of current position resolves it.
  const cued = pool
    .filter(h => currentCue(text, h.matched) === 'cue')
    .sort((a, b) => a.stageNumber - b.stageNumber);

  if (cued.length === 1) {
    const best = cued[0];
    return {
      stageNumber: best.stageNumber,
      stageKey: best.key,
      confidence: best.strong ? 'high' : 'medium',
      matched: best.matched,
      alsoMatched: others(best.stageNumber),
    };
  }

  // No cue, or cues on more than one stage. The admin decides — see the header.
  return {
    stageNumber: null,
    stageKey: null,
    confidence: 'ambiguous',
    matched: null,
    alsoMatched: hits
      .sort((a, b) => a.stageNumber - b.stageNumber)
      .map(h => ({ stageNumber: h.stageNumber, matched: h.matched })),
  };
}

/**
 * Words that say "this is where we are", immediately around a stage phrase.
 *
 * Deliberately narrow, and deliberately positional: the cue has to sit next to THAT phrase,
 * not merely somewhere in the sentence. "Foundation is complete; roofing materials are
 * ordered" contains no cue on `roofing`, so roofing does not win — which is the whole point.
 *
 * `BEFORE` cues precede the phrase ("starting the roof", "now on finishing"). `AFTER` cues
 * follow it ("roofing is under way"). `NOT_YET` cues mean the phrase is what comes NEXT and
 * is therefore explicitly NOT the current stage, so it disqualifies rather than confirms.
 */
const BEFORE  = ['starting', 'start', 'we are on', 'now on', 'now at', 'we are at', 'now',
                 'currently', 'doing', 'we are doing', 'working on', 'busy with',
                 'on commence', 'nous sommes a', 'nous sommes aux', 'en cours de', 'actuellement'];
const AFTER   = ['in progress', 'under way', 'underway', 'ongoing', 'is on', 'en cours'];
const NOT_YET = ['before we start', 'before starting', 'next is', 'next week', 'next month',
                 'after that', 'materials', 'ordered', 'yet to', 'about to',
                 'avant de commencer', 'ensuite', 'pas encore', 'la semaine prochaine'];

type Cue = 'cue' | 'not_yet' | null;

function currentCue(text: string, phrase: string): Cue {
  const padded = ` ${text} `;
  const at = padded.indexOf(` ${phrase} `);
  if (at < 0) return null;

  // A window either side, wide enough for "we are now starting the …" and no wider. Position
  // is the whole point: a cue elsewhere in the sentence belongs to a different stage.
  const before = padded.slice(Math.max(0, at - 28), at + 1);
  const after  = padded.slice(at + phrase.length + 1, at + phrase.length + 25);

  // "Not yet" wins over any positive cue: a sentence saying a stage is coming up is evidence
  // that it has NOT been built, which is stronger than a nearby "starting".
  if (NOT_YET.some(c => before.includes(c) || after.includes(c))) return 'not_yet';
  if (BEFORE.some(c => before.includes(c)) || AFTER.some(c => after.includes(c))) return 'cue';
  return null;
}
