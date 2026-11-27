# Folia source and adaptation notice

Upstream project: [Folia](https://github.com/chthollyphile/folia-major)  
Upstream author: chthollyphile and Folia contributors  
Source revision: `b0d2d74e4f4458879f6a53c31bcdb4144d06d754`  
License: GNU Affero General Public License, version 3 (AGPL-3.0)  
License text: [Folia-AGPL-3.0.txt](Folia-AGPL-3.0.txt)  
Original license: [Folia LICENSE at the source revision](https://github.com/chthollyphile/folia-major/blob/b0d2d74e4f4458879f6a53c31bcdb4144d06d754/LICENSE)

Copyright (c) 2026 chthollyphile. Upstream copyrights remain with their respective authors.

## Adaptation scope

Vesper's native JavaScript / Canvas 2D lyric style renderers under
`app/public/js/modules/20-vesper/` adapt selected Folia lyric placement and
animation algorithms and presentation concepts. The affected source carries a
Folia adaptation header. Adapted Folia code is provided under AGPL-3.0; retaining
this notice does not replace the other requirements of that license.

The adapted style IDs are:

`classic`, `partita`, `cadenza`, `fume`, `tilt`, `claddagh`, `pendolo`,
`cappella`, `monet`, `sonnet`, `tempera`, and `diorama`.

Algorithm and visual-reference source paths below are relative to the pinned
Folia repository. Listing a source does not imply that its entire implementation
was copied; the mode mapping describes the actual adaptation scope:

- `src/components/visualizer/classic/Visualizer.tsx`
- `src/components/visualizer/GlowWord.tsx`
- `src/components/visualizer/glowWordTiming.ts`
- `src/components/visualizer/glowWordVariants.ts`
- `src/components/visualizer/partita/partitaLayout.ts`
- `src/components/visualizer/partita/VisualizerPartita.tsx`
- `src/components/visualizer/cadenza/cadenzaPlacements.ts`
- `src/components/visualizer/cadenza/cadenzaEnvelopes.ts`
- `src/components/visualizer/cadenza/VisualizerCadenza.tsx`
- `src/components/visualizer/fume/fumeMath.ts`
- `src/components/visualizer/fume/fumeReveal.ts`
- `src/components/visualizer/fume/fumeCamera.ts`
- `src/components/visualizer/tilt/VisualizerTilt.tsx`
- `src/components/visualizer/claddagh/claddaghLayout.ts`
- `src/components/visualizer/claddagh/CladdaghRingLine.tsx`
- `src/components/visualizer/claddagh/claddaghTimeline.ts`
- `src/components/visualizer/pendolo/pendoloGeometry.ts`
- `src/components/visualizer/pendolo/pendoloTimeline.ts`
- `src/components/visualizer/cappella/cappellaMessageLayout.ts`
- `src/components/visualizer/cappella/CappellaMessageRow.tsx`
- `src/components/visualizer/monet/monetRailLayout.ts`
- `src/components/visualizer/monet/monetLyricMotion.ts`
- `src/components/visualizer/sonnet/sonnetTypographyRoles.ts`
- `src/components/visualizer/sonnet/sonnetGlyphLayout.ts`
- `src/components/visualizer/sonnet/sonnetMotion.ts`
- `src/components/visualizer/sonnet/sonnetShotFrame.ts`
- `src/components/visualizer/tempera/temperaCompositions.ts`
- `src/components/visualizer/tempera/temperaMotion.ts`
- `src/components/visualizer/tempera/temperaMotionEasing.ts`
- `src/components/visualizer/tempera/temperaEnterStyles.ts`
- `src/components/visualizer/diorama/dioramaSceneLayout.ts`
- `src/components/visualizer/diorama/dioramaSceneFrame.ts`
- `src/utils/lyrics/renderHints.ts`

Changes include replacing upstream React / Framer Motion / Pixi renderer
integration with Vesper's Canvas 2D drawing and lifecycle, adapting text
measurement, and reading Vesper's existing LRC / YRC data and media clock.
The 2026-11-16 revision adds per-word entrance/active/passed poses, deterministic
spring responses and overlapping line exits. Plain LRC uses a short staggered
entrance as a presentation decision; it does not claim inferred times are real
word alignment. Empty lyric pixels remain transparent over the user's wallpaper.
Original blur envelopes are represented with local glyph glow and opacity in
Canvas, avoiding per-glyph full-surface filters; this is not a pixel-identical
port of upstream post-processing. Motion, scaling, rotation and timing remain
driven by Vesper's media clock.
This adaptation does not bundle the complete Folia application or all its
renderers, presets, scene assets, effect engines, or tuning controls.
Folia has 17 registered modes at this revision; these 12 native adaptations
are not a claim that all 17 original modes have been ported.

Vesper's player, account integration, lyric time adapter, and style selector
remain implementations of this project. Individual files and other incorporated
components retain their applicable licensing notices. For provenance, the mode
mapping and limitations, see `docs/FOLIA_LYRICS.md` in this source distribution.

Folia is not affiliated with and does not endorse this adaptation.

