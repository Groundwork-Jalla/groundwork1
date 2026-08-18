# Image credits

Attribution for third-party photography shipped in this repo.

## None currently

The wizard preview panel (steps 2, 3 and 7) no longer uses photography. It draws
architectural sketches instead — `src/components/wizard/blueprints/`, one per
selectable project type, building type and roof covering.

That removed the two problems the photographs kept producing:

- **Subject drift.** A stock photo only loosely illustrates the label it sits
  under, and an earlier set had been chosen without checking — it included a
  welding torch captioned "Duplex". A drawing made for the label cannot drift
  from it.
- **Dead URLs.** Twelve entries were hotlinked from Unsplash and `clay_tiles`
  had already 404'd in production, which is why the panel still carried a
  failure fallback. The sketches are code; there is nothing to fetch.

The nine local `public/building-types/*.webp` files that replaced the worst of
the hotlinks were deleted with them.

If photography returns anywhere in the product, credit it here. Wikimedia Commons
**Quality Images** was the one source that could be both searched and inspected
before use — Unsplash, Pexels, Pixabay and openverse.org all sit behind bot
challenges that block automated search.
