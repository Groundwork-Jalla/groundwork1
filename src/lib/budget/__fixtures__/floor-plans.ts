/**
 * Text layers from real architects' floor plans.
 *
 * Captured by running the exact reader `extract-bq` uses — pdf.js, grouped into lines
 * by rounded Y — over the PDFs themselves, so these are byte-for-byte what the
 * extractor is handed in production, tabs and stray spaces included. Hand-typed
 * samples were how the original patterns came to look for sentences no drawing
 * contains; a fixture taken from the real thing is the only kind that would have
 * caught it.
 */

/**
 * Mr Nas, Ground Plan — AutoCAD Architecture 2018, printed to A4.
 *
 * Uploaded through /admin/projects/new on 28 October 2026 alongside a bill of
 * quantities totalling 59,675,280 XAF, which read correctly. The plan reported
 * "floor count not extracted · area not extracted" — from THIS text, which names
 * five bedrooms, five toilets, three kitchens, three sitting rooms, a staircase,
 * and an overall 21.25 x 10.30 footprint.
 *
 * It is three dwelling units in one block, not a house: three sitting rooms, three
 * kitchens and three verandas, each with its own entrance. Nothing in the text says
 * so — that is the limit of what counting labels can tell you, and the reason the
 * sheet count and the unit count are not claimed here.
 */
export const MR_NAS_GROUND_PLAN = `A
21.25
3.15	 	2.15	 	2.15	3.15	1.35	1.50	3.15	1.35	3.15
.60	1.20
1.05	 	1.20	 	1.45	1.20	.95	1.20	.40	1.05	1.20	1.35	.60	.75	1.50	1.35	.60	1.35	1.20	1.05
Porch
2.00	1.00
3.00	 	3.00	 
2.15
1.35	3.00
2.00	1.20	3.00
1.20
Toilet	 
Toilet	 
Toilet
2.15
3.40
3.55
Dinning
3.25
3.95
Bed Room2	 	Kitchen
Bed Room2	Bed Room
3.20
3.40
M.Bed Room1	 
2.20
3.40
1.10
Lobby
Lobby
2.00
 
 
1.45
1.30
Lobby	2.80
.60	Sitting Room	 
Kitchen
Sitting Room
Toilet
Sitting Room	 
4.95
4.80
 	3.40
4.35	4.05
1.95	1.05	4.35	 	4.35
2.15
1.05
10.30
2.50	 
10.30
1.50
1.65
.60
Dinning
Toilet
4.95
 
1.00
 
M.Bed Room1
 
3.50
2.35	 
4.00
3.00	 	4.35	 	4.35	1.00	 	1.00
 
4.10
3.65
 
 
3.05
2.35	A
Kitchen
1.50
1.50
Stair case
1.65
VERANDA	 	VERANDA	 
VERANDA
1.50	.72	1.50	1.50	2.00	.15
1.05	 	1.20	 	1.05	.85	2.00	.73	1.20	.85	2.00	.15	1.20	 	1.10	.50
3.15	 	4.50	2.50	4.50	2.30	4.15
21.25
GROUND PLAN`;
