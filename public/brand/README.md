# Groundwork brand assets

Every file here is generated from the real typeface with the letterforms **converted to
outlines**. Nothing references a font by name, so they render identically on a machine
that has never heard of Plus Jakarta Sans — which is the failure the old favicon had:
it used `<text font-family="Plus Jakarta Sans">`, and favicons render in an isolated
context with no access to the page's webfonts, so it silently fell back to Arial Black.

- Wordmark: **Plus Jakarta Sans ExtraBold (800)**, tracking `-0.025em`
- Byline: **Plus Jakarta Sans Medium (500)**, tracking `+0.025em`
- Kerning applied via HarfBuzz shaping, so pairs like `wo` and `rk` sit as designed

The family has no weight 900. The site asks for `font-black`, which resolves to 800 or a
synthetic bolding depending on the browser; these files use the genuine 800.

## Which file to send

| You need | Use |
|---|---|
| Logo on a **white / light** background | `groundwork-wordmark-on-light.svg` |
| Logo on a **dark or coloured** background | `groundwork-wordmark-on-dark.svg` |
| Square icon, light background | `groundwork-mark-on-light.svg` |
| Square icon, dark background | `groundwork-mark-on-dark.svg` |
| Social avatar / app icon (needs its own tile) | `groundwork-mark-plate-dark.svg` |
| Same, but on a dark deck where a black tile would disappear | `groundwork-mark-plate-light.svg` |

**Send the SVG whenever the recipient can take one** — print, decks, signage, anything
that scales. PNGs exist for tools that reject SVG (some social uploaders, older Office).

## Files

```
groundwork-wordmark-on-light.svg     ink #0a0a0a  + grey #5a5a57   transparent
groundwork-wordmark-on-dark.svg      white       + white 55%       transparent
groundwork-mark-on-light.svg         ink G                          transparent
groundwork-mark-on-dark.svg          white G                        transparent
groundwork-mark-plate-dark.svg       white G on #0a0a0a tile        rounded corners
groundwork-mark-plate-light.svg      ink G on white tile            rounded corners
```

PNG exports sit beside each SVG with the pixel width in the filename — wordmarks at
1024 and 2048 wide, marks at 512 and 1024 square. All have **real alpha**: the
non-plate files are fully transparent, and the plate files have their rounded corners
cut out rather than filled to the bounding box.

## Colours

| Token | Hex | Used for |
|---|---|---|
| Ink | `#0a0a0a` | wordmark and mark on light grounds; the dark tile |
| Mid grey | `#5a5a57` | "by Jalla" on light grounds |
| White | `#ffffff` | wordmark and mark on dark grounds; the light tile |
| White 55% | `rgba(255,255,255,0.55)` | "by Jalla" on dark grounds |

## Clear space and minimum size

Each SVG carries 8 units of padding in its own viewBox, roughly the height of the "o".
Keep at least that much clear on every side.

The wordmark stops being legible below about **90px wide** — use the mark instead. The
mark holds down to 16px, which is what the favicon renders at.

## Do not

- Retype the logo in a live font. That's what produced the wrong letterform in the old
  favicon. Always use these files.
- Put `-on-dark` files on a light ground or vice versa; the byline is the give-away, it
  goes invisible.
- Recolour, stretch, rotate, add effects, or box the transparent versions.

## Regenerating

Built by a script that downloads the two weights, shapes each string with HarfBuzz and
emits outlined paths. It is not checked in — if the wordmark or the typeface ever
changes, ask and it can be rebuilt. Do not hand-edit the path data in these files.

`/favicon.svg` and `/favicon.ico` at the site root are generated from the same "G"
outline, so the tab icon and these assets are the identical letterform.
