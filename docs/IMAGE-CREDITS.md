# Image credits

Attribution for third-party photography shipped in this repo.

## `public/building-types/`

These illustrate the wizard preview panel (steps 2, 3 and 7). Each was picked by
searching Wikimedia Commons **Quality Images**, then opening the candidate and
confirming by eye that the subject matches the label it appears under — the
previous set had been chosen without that check and included a welding torch
captioned "Duplex" and a dead URL for "Clay Tiles".

All are licensed **CC BY-SA**. Each file here is cropped to 4:3 and re-encoded to
WebP, which makes it an adaptation: the adaptations are published under the same
licence as their source. Attribution below satisfies the BY term.

| File | Source | Author | Licence |
|---|---|---|---|
| `industrial.webp` | [Forchem Rauma 2.jpg](https://commons.wikimedia.org/wiki/File:Forchem_Rauma_2.jpg) | kallerna | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `mixed_use.webp` | [Sal Cape Verde Santa Maria house.jpg](https://commons.wikimedia.org/wiki/File:Sal_Cape_Verde_Santa_Maria_house.jpg) | Cayambe | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| `townhouse.webp` | [Holasice - nová zástavba.jpg](https://commons.wikimedia.org/wiki/File:Holasice_-_nov%C3%A1_z%C3%A1stavba.jpg) | RomanM82 | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| `retail.webp` | [Münster, Prinzipalmarkt -- 2014 -- 4516-20-2.jpg](https://commons.wikimedia.org/wiki/File:M%C3%BCnster,_Prinzipalmarkt_--_2014_--_4516-20-2.jpg) | Dietmar Rabich | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `hotel.webp` | [Cordoba Center Hotel in Cordoba, Spain.jpg](https://commons.wikimedia.org/wiki/File:Cordoba_Center_Hotel_in_Cordoba,_Spain.jpg) | Edmundo Sáez | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `transit_oriented.webp` | [Melbourne (AU), Flinders Street Railway Station -- 2019 -- 1583.jpg](https://commons.wikimedia.org/wiki/File:Melbourne_(AU),_Flinders_Street_Railway_Station_--_2019_--_1583.jpg) | Dietmar Rabich | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `clay_tiles.webp` | [Tiled roof of San Nicolò l'Arena1.jpg](https://commons.wikimedia.org/wiki/File:Tiled_roof_of_San_Nicol%C3%B2_l%27Arena1.jpg) | The Cosmonaut | [CC BY-SA 2.5 CA](https://creativecommons.org/licenses/by-sa/2.5/ca/deed.en) |
| `long_span_aluminum.webp` | [VDNKh Ventilation cap on roof of Pavilion No 48 and trees.jpg](https://commons.wikimedia.org/wiki/File:VDNKh_Ventilation_cap_on_roof_of_Pavilion_No_48_and_trees.jpg) | Dmitry Ivanov | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `concrete_flat.webp` | [20230317.Dresden.Neue Mensa Bergstraße.-017.jpg](https://commons.wikimedia.org/wiki/File:20230317.Dresden.Neue_Mensa_Bergstra%C3%9Fe.-017.jpg) | Bybbisch94, Christian Gebhardt | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |

## Remaining hotlinked images

The other fifteen entries in `BUILDING_IMAGES`
(`src/components/wizard/BuildingPreview.tsx`) still point at
`images.unsplash.com`. The [Unsplash licence](https://unsplash.com/license)
grants free commercial use with no attribution required, so they are listed here
only for provenance, not obligation.

Those are hotlinks, which is how `clay_tiles` came to 404 in production. If we
want the same guarantee the files above now have, download them into
`public/building-types/` and switch their entries to local paths — the map is
typed so nothing else has to change.

> **Note on sourcing.** Unsplash, Pexels, Pixabay and openverse.org all sit
> behind bot challenges that block automated search, so replacements could not be
> matched to the existing Unsplash look. Commons Quality Images was the one
> source that could be searched *and* inspected before use. If an Unsplash API
> key is added to the environment, these nine can be re-matched to that style.
