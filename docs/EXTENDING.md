# Extending Crowns of Coral

The rule engine does not live in UI components. Definitions use stable string IDs in `data/`; the UI resolves names and descriptions through `data/locales.json`. Additions must preserve existing IDs and save schema compatibility.

## Add a ship

1. Add a definition to `data/units.json` with a new stable `id`, `nameKey`, `descriptionKey`, `icon`, `model`, `sprite`, resource `cost`, `buildTurns`, `maxHp`, `move`, `vision`, `attack`, `range`, `armor` and `upkeep`.
2. Add the same name and description keys in EN, FR and ES. The translation parity test requires identical key sets.
3. Create the model in `assets/scripts/generate_assets.py`, or a separate Blender Python generator. Keep the `.blend` in `assets/blend/`, export GLB to `assets/glb/`, and render a transparent PNG for every faction in `assets/sprites/`. Reference the base model/sprite explicitly in the definition.
4. Existing production, movement, upkeep, repair and deterministic combat rules work from the numeric fields. If the ship needs a genuinely new ability, implement it in `src/core/engine.js` and expose its exact forecast through `previewAttack`; do not place rule logic in `src/ui/`.
5. Add tests for cost, production time, movement and the new ability. Run `npm test` and a complete simulation.

## Add a building

1. Add a stable definition to `data/buildings.json`: `cost`, `buildTurns`, `income`, model/sprite references and optional `requiresTech`, `portAttack`, `portHp` or `repair`.
2. Add trilingual name and description keys. Add the Blender source, GLB and rendered sprite.
3. Existing income, queue, construction and drydock fields are consumed by the engine. A new effect requires a data-driven branch in the relevant core function and tests; UI buttons are generated automatically from `productionOptions`.
4. If it is a unique victory building, use `uniquePerPort` and add explicit victory tests. Great lighthouses must remain on distinct port reefs.

## Add a terrain

1. Add a stable definition to `data/terrain.json` with `baseMove`, `habitable`, visual references and color. Use `passable:false` for permanent obstacles, `passablePhases` for seasonal passages, or `phaseMove` for tide-dependent costs.
2. Choose an unused single-character token in `data/map-reference.json` and map it to the terrain, optional `resource`, `yield` or `site`. Keep every row exactly 11 characters and all nine rows.
3. Add trilingual text and the actual model/render assets. If the renderer needs a new visual treatment, keep it presentational in `MapRenderer.drawTileBase`.
4. Test passability in every tide, movement costs, exploration memory and save/reload. Never make a tide destroy or permanently trap units.

## Add a technology node

1. Add a stable definition to `data/technologies.json` with `branch` (`navigation`, `economy` or `fleet`), `cost`, `turns`, `prerequisites`, `effects`, icon and model reference.
2. Add trilingual names/descriptions. Prerequisites must refer to existing IDs and must not form a cycle.
3. Numeric effects are applied in `unitStats`, `portStats`, `incomeReport`, `completeResearch` or production availability in `src/core/engine.js`, as appropriate. Add a new effect only with a focused test proving both its timing and exact result.
4. If it unlocks a building, set the building’s `requiresTech` to the technology ID. The research UI builds its three branches automatically.

## Add a faction using existing rules

1. Add a stable definition to `data/factions.json` with localized `nameKey`, unique `emblem`, `sail`, `silhouette`, two readable colors, `human:false` and an explicit model reference.
2. Add a start to `data/map-reference.json`: faction ID plus capital, scout and colonizer coordinates. Capitals must be on habitable reefs. Provide nearby resources and an expansion reef comparable to the other starts.
3. Add trilingual faction names and original sail/emblem variants in Blender and the renderer. Preserve readability at minimum zoom; color cannot be the only differentiator.
4. The existing AI uses common production, research, movement and combat rules and only its own explored/visible data. If a faction-specific AI preference is wanted, keep strategy weights separate from hidden information and rule enforcement.
5. Test a complete game with the new faction, the last-port defeat and both capital/lighthouse victory checks. Rebalance the turn-40 score only with an explained, public formula.

## Regenerate original assets

The project was produced with Blender 4.5.3 LTS. With Blender available on PATH:

```sh
blender --background --python assets/scripts/generate_assets.py
```

The script overwrites generated Blender scenes, GLB exports, sprites, nacre texture and cover. Review changes before committing. It does not download assets or require third-party Python packages.

## Release checks

Run `npm test`, `npm run simulate`, play the static build through HTTP, then run the LOB7 local preflight. Keep `MISSION.json` and evidence separate for local tests, private preview, publication and public-browser play. Pin the exact public GitHub commit for LOB7 preparation.
