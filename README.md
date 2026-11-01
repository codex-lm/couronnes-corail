# Crowns of Coral / Couronnes de Corail

A complete, tide-driven miniature maritime 4X for the browser. Three civilizations explore a hand-authored 11 × 9 archipelago, found up to four ports, exploit three resources, research twelve technologies and fight for two routes to victory.

Designed and developed with Kimi for Kimi Games. English is the default interface; French and Spanish are included.

**Play the published edition:** https://lob7.com/player/br_s_7d8fa223-b782-400a-8cc8-1490127f6f78

## Play

No build, account, server logic or runtime dependency is required. Serve this directory over static HTTP:

```sh
python -m http.server 8765
```

Open `http://localhost:8765`. The game uses local JSON and PNG assets, so opening `index.html` through `file://` is not supported. All assets and ES modules are local; no external service is called.

For a deterministic demonstration using the ordinary rules and AI actions, open `?autoplay=1`. It does not save over the current expedition.

## The game

- **Explore:** scouts reveal tiles; explored waters remain in memory. Three ruin types offer a one-time reward or decision.
- **Read the tide:** every four complete rounds, the announced tide changes. Sandbars open at low and falling tide. Currents cost 2 movement at low tide and 1 otherwise. Ships on a closing sandbar are never damaged and can always leave.
- **Expand:** settler ships found ports on habitable reefs and disappear. Each port exploits up to two neighboring resource sites and has one development focus. A civilization can hold at most four ports, including captures.
- **Develop:** provisions fund expeditions and fleet upkeep, materials fund ships and buildings, and knowledge funds research. Every port has a two-slot production queue with visible costs and durations.
- **Fight:** scouts, settler ships, escorts and bombardiers follow deterministic combat rules. Exact damage, retaliation and destruction/capture risks are shown before confirmation. Escorts protect adjacent allies. Damaged ships repair at allied ports.
- **Win:** build three great lighthouses on distinct reefs after researching Pharos Architecture, or hold both rival capitals simultaneously. Turn 40 ends with an explained public score. Losing your last port causes defeat.

A typical first game is balanced for roughly 20–40 minutes. The reference AI game included in `evidence/simulation.json` reaches a lighthouse victory on turn 27.

## Controls and saving

Click or tap a ship, then a highlighted destination. Click or tap an enemy in range to inspect and confirm an attack. Drag to pan; use the wheel, pinch or +/− buttons to zoom. Escape closes optional panels. All essential actions work with mouse or touch.

The current expedition, language and sound preferences are saved locally in the browser. The menu offers Continue after a reload. Saves are not promised to migrate between hosted editions.

## Verification

On the `development` branch, run `npm test`, `npm run simulate`, `python tests/browser_smoke.py` and `python tests/browser_journey.py` against the static export.

There are no runtime dependencies. Tests cover movement, tides, income, production, research, deterministic combat, escort protection, capture, repair, fog memory, discoveries, both primary victories, the turn-40 score, save round-trips, content translations and real Blender/GLB signatures. A complete AI game verifies port caps, valid resources and a decisive ending. The Playwright journeys exercise the actual exported game on desktop and touch layouts, including local save reload, languages, tides, a complete ending and restart.

## Rebuild the static export

The committed `index.html` is the self-contained playable export, with inline JavaScript, CSS and a PNG favicon. Local JSON and image files remain beside it. No build is needed on this static-export branch.

The [`development` branch](https://github.com/codex-lm/couronnes-corail/tree/development) additionally contains `package.json`, the lockfile and `scripts/build.mjs`. There, run `npm install` followed by `npm run build` to bundle `src/ui/app.js` and inline it with `src/ui/styles.css` into `src/ui/index.template.html`. Always test the generated `index.html` before exporting it to this branch. LOB7 does not run npm, Blender or repository scripts.

## Source layout

- `src/core/`: rules, data loading, hex mathematics, AI and local save serialization.
- `src/ui/`: Canvas renderer, DOM interface, translations and synthesized audio.
- `data/`: stable IDs, map, units, buildings, terrain, technologies, factions and EN/FR/ES text.
- `assets/scripts/generate_assets.py` and `assets/blend/`: original generator and 36 editable Blender scenes, retained on `development`.
- `assets/glb/`: 35 exported models, 18 with embedded animations, included in the static export.
- `assets/sprites/`: transparent isometric renders used by the game.
- `assets/textures/`: generated nacre texture, also packed in relevant Blender files.
- `art/`: Blender-rendered cover and favicon.
- `docs/EXTENDING.md`: data and rules extension guide.
- `MISSION.json`: one-off workshop mission and separate local/public verification status.
- `evidence/`: reproducible local simulation and verification records.

The committed static files are the playable LOB7 export. LOB7 does not run Blender, npm or any repository script when preparing the game.

## License and provenance

Code, models, textures, rendered art, interface and synthesized audio are original works created for this project and released under the MIT License. See `LICENSE` and `CREDITS.md`. Models were actually generated and rendered with Blender 4.5.3 LTS; Blender itself is a tool and is not redistributed in this repository. No third-party runtime library or external asset is used.
