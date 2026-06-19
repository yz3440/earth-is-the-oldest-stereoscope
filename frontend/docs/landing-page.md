# Landing / Introduction — Technical Snapshot

> Saved before removing the introduction from the default entry flow (June 2026, branch `fix-intro`).
> This captures **how the current landing works**, **why**, and the **paused redesign direction**, so the
> work is recoverable even if the intro is hidden or stripped. Nothing here is deleted from the codebase —
> the `introduction` view and `IntroductionView` component remain; only the default entry point changes.

---

## 1. What the landing is today

On load, `view` defaults to **`'introduction'`** (`src/state.ts`). The introduction is a **takeover view**: a
2-page guided card pinned to the bottom of the screen, floating over the **mono 3D orbital diagram**
(`PlanetaryScene`). The actual stereo footage is *not* shown until the user exits the intro into the
`stereo` view.

Three views, switchable via the bottom-bar tabs and `Tab`: `introduction` → `stereo` → `sim`
(`src/main.tsx` keydown handler; order `['introduction','stereo','sim']`).

---

## 2. Files involved

| File | Role in the landing |
| --- | --- |
| `src/state.ts` | `view` (default `'introduction'`), `introductionPage`, `INTRODUCTION_PAGE_COUNT` (= 2), `nextIntroductionPage` / `prevIntroductionPage`, `introductionCardHeight`, `videosReady`, `loadProgress`, `isNarrow`. |
| `src/components/IntroductionView.tsx` | The card UI, copy, page dots, stats, nav buttons, keyboard handling, card-height measurement. |
| `src/main.tsx` | Camera choreography per page (the `effect` at ~L682), `keyframeForPage` (~L583), `applyCardLift` (~L664), `eyeAxisUp` (~L567); render branch (~L780) that draws `PlanetaryScene` for `introduction`/`sim`; `updateBodyScales(view==='introduction')` (~L766). |
| `src/scene.ts` | The 3D diagram: bodies, gaze/baseline lines, the **intentional scale exaggeration** (`updateBodyScales`, ~L450; Moon mesh at 4× radius, L120), camera tween primitives (`tweenCameraTo`, `snapCameraUp`, `setControlsEnabled`). |
| `src/App.tsx` | Mounts `IntroductionView`; toggles which canvas (stereo vs. sim/diagram) is visible per `view`. |
| `src/components/BottomBar.tsx` | The view tabs (INTRODUCTION / STEREOSCOPY / SIMULATION) + playback controls. |

---

## 3. The card (`IntroductionView.tsx`)

- **Layout:** a single full-width card, `min(720px, 100vw-32px)`, pinned bottom-center, `padding: 0 16px 80px`.
  Two-column (title left, body right) on desktop; single column when `isNarrow`. Background
  `rgba(0,0,0,0.78)` + `backdrop-filter: blur(10px)`, 1px `--line` border.
- **Type:** title in **`"Redaction 35"`** serif (`HEADING_FONT`, L17), `clamp(20px,2.4vw,28px)`; body in the
  inherited monospace at 12px. Palette via CSS vars: `--text`, `--text-2`, `--text-3`, `--line`, `--line-2`.
- **Page 0 — "Earth is the Oldest Stereoscope"** (`page0Content`, L84): title + a 2-sentence concept line +
  a live **stats block** (`Stat` rows: Baseline Boston↔Santiago km, Moon distance km, Parallax angle °,
  all computed from `computeFrame(currentTime)`) + credit "Made by [Yufeng Zhao], with help from Carlos in
  Chile."
- **Page 1 — "How to See It"** (`page1Content`, L134): wiggle explanation + `TAB` / `SPACE` / `F` shortcuts +
  a pointer to `CONTROLS` for anaglyph / side-by-side / shutter modes.
- **Footer:** `PageDots` (count = `INTRODUCTION_PAGE_COUNT`), `SKIP` (→ `stereo`), `BACK` (disabled on page 0),
  `NEXT` / `ENTER` (last page label). An ambient **load-progress bar** (`loadProgress`) shows above the
  footer until `videosReady`; it never blocks `ENTER`.
- **Keyboard** (effect, L343): `Esc` → `stereo`; `→`/`Enter` → next page; `←` → prev page. Ignored while
  focus is in an input/select/textarea.
- **Card height** (effect, L194): a `ResizeObserver` publishes the card's height to `introductionCardHeight`
  so the camera framing can lift the bodies above the card (see `applyCardLift`).

> Note: the **deployed** site (`stereoscope.yufeng.place`) still shows an older **4-page** intro
> (page 1 "The Angle" with a stats table + "Human eyes sit ~6 cm apart…" explainer). The working tree on
> `fix-intro` already consolidated this to **2 pages**.

---

## 4. Camera choreography (`main.tsx`)

The introduction `effect` (~L682) locks OrbitControls (`setControlsEnabled(false)`) and tweens the camera to a
per-page keyframe:

- **`keyframeForPage(0)`** — wide system view. Frames Earth + Moon within a sphere around their midpoint;
  camera offset from a fixed diagonal `dir = (0.3,0.5,0.8)` so it reads as 3D, not a flat plot. Up = world Y.
- **`keyframeForPage(1)`** — "The Angle". Camera sits perpendicular to the Earth–Moon axis, lifted ~0.28·D
  above the ecliptic. Crucially, up = **`eyeAxisUp(...)`** (L567), which rolls the camera so the
  **Boston→Santiago baseline lands horizontally on screen with Boston on the left** — the "your two eyes are
  Boston and Santiago" mapping. Mirrors the `corrected` branch of `scene.ts orientTelescope`.
- **`applyCardLift`** (L664) shifts the look-at target down (in screen space) by half the card's vertical
  fraction so bodies float above the card.
- **Entry** jumps to keyframe 0 instantly (duration 0) and resets `introductionPage` to 0. **Page changes**
  tween over 900 ms; viewport/card-height changes snap (duration 0). **Exit** unlocks controls and
  `snapCameraUp(WORLD_UP)` so the free-look `sim` view starts upright.

---

## 5. The intentional scale exaggeration (`scene.ts`) — "the scale is a little bit off"

Astronomy diagrams universally exaggerate body sizes vs. distances; at true scale an Earth/Moon are invisible
against ~60 ER of space. Two mechanisms inflate them **only in the intro**:

1. **Moon mesh at 4× radius** — `SphereGeometry(MOON_RADIUS_ER * 4, …)` (L120). `MOON_RADIUS_ER = 1737.4/6371`
   ≈ 0.273, so the mesh is ~1.09 ER instead of ~0.273 ER.
2. **`updateBodyScales(active)`** (L450) — when `active` (= intro view), projects each body onto the camera,
   measures its on-screen radius, and scales the mesh up to hit `MIN_BODY_RADIUS_PX = 36`. The Earth wireframe
   and pole-axis are children of `this.earth`, so they scale with it. When `!active`, scales reset to 1 —
   `sim`/`stereo` views see **physically accurate** sizes.

Positions are always physical: `applyFrameState` places bodies with `scale = AU_TO_ER`, so distances are true
Earth radii. The **gaze lines** (Boston→Moon, Santiago→Moon) and **baseline** (Boston→Santiago) are real
`THREE.Line`s updated each frame (L142–L154, L257–L259), drawn with `depthTest:false` so they read over the
bodies.

---

## 6. Why it's being reworked (design rationale)

From the Wrong Eclipse critique (`opencall/wrong_biennale_application.md`): the landing "explains before it
seduces" and "feels like a tech demo" — the actual art (the Moon footage) is hidden behind `ENTER`, the
2-page card is a product-funnel/onboarding wizard, and it leads with a precision/stats flex instead of the
concept. The craft (Redaction 35 + mono + warm-grey-on-black) is good and worth keeping.

---

## 7. PAUSED redesign direction — the 2D-contour landing

Explored June 2026, then paused in favor of the "straight to video" pivot (§8). Captured here so it can be
resumed.

**Concept:** keep the 3D scene for *positions* but render the landing as a stylized **2D line-art diagram** at
**real (un-exaggerated) scale**: the **Moon top-left**, the **Earth bottom-right as a contour outline**, and
the **two telescope sightlines** connecting them. At true scale the two sightlines diverge by only the real
**~1.18° parallax**, so they fan apart at the Earth and **very nearly merge** by the Moon — the tiny parallax
made literal and poetic.

**Decisions captured (from the art-direction Q&A):**
- **Moon:** rendered as the **textured 3D moon** (keep the shaded/textured sphere; not footage, not a contour).
- **Scene context:** **strip to a clean diagram** — just Earth contour + Moon + the two sightlines on black;
  hide Sun, stars, penumbra cones, wireframe, markers.
- **Scope:** this composition becomes the **new page-0 landing**, replacing the wide-system framing.

**Implementation sketch:**
- Disable the exaggeration on this view: real Moon radius (drop the `*4`) and skip `updateBodyScales`.
- Add a **full-screen SDF fragment shader** (Three.js orthographic full-screen quad, à la the existing
  `ShaderMaterial` setup in `shaders.ts`, or a separate transparent overlay) fed by the **3D-projected screen
  positions** of: Earth center + projected radius, the Moon, and the Boston/Santiago observer points. The
  shader strokes the Earth's contour ring and the two lines (crisp, anti-aliased, stylable: glow/dashes).
- New page-0 keyframe: compose so Moon ≈ top-left, Earth ≈ bottom-right (camera framing / target offset).

---

## 8. Implemented — straight to the stereo video (June 2026)

The introduction is no longer the default entry. On load the app goes **straight into the stereo video**, with
the **full 2-page card floating over it** as a dismissible pop-up. What changed:

- **`src/state.ts`** — default `view` is now `'stereo'` (stale persisted `'introduction'` is coerced to
  `'stereo'`). New **`showIntro`** signal (non-persisted, default `true`) controls the card. Helpers
  `openIntroduction()` (reset to page 0 + show) and `closeIntroduction()` (hide); `nextIntroductionPage()` on
  the last page now closes the pop-up instead of switching view.
- **`src/components/IntroductionView.tsx`** — the card is gated on `showIntro` (not the view). SKIP / ENTER /
  Esc call `closeIntroduction()`. Copy, stats, page dots, and the load bar are unchanged.
- **`src/components/BottomBar.tsx`** — the INTRODUCTION view-tab is replaced by an `IntroButton` that calls
  `openIntroduction()` (active styling while the card shows). STEREOSCOPY / SIMULATION remain view tabs.
- **`src/main.tsx`** — the `Tab`-key cycle is now `['stereo','sim']`; while `showIntro` is open, playback
  shortcuts are swallowed so the card's arrow/enter/esc navigation isn't doubled by seek/play.

Nothing was deleted: the `introduction` value stays in the `View` union and the dormant camera-choreography
effect + diagram-as-background rendering remain in `main.tsx` (plus `IntroductionControls` in
`ControlPanel.tsx`), so the takeover intro — and the paused 2D-contour direction in §7 — can be re-enabled
later. Verified June 2026: default lands on the stereo view with the card up; SKIP / ENTER / Esc dismiss;
the bottom-bar INTRODUCTION button reopens at page 0; `tsc --noEmit` passes.

## 9. Centered concept redesign (June 2026)

The pop-up was rebuilt as a **centered modal** (was bottom-pinned) and expanded from 2 to **3 pages**, ordered
**concept → rooftops → implementation**, using the artist's own words from the project page
(`yufengzhao.com/projects/earth-is-the-oldest-stereoscope`):

- **Page 0 — concept:** the Nam June Paik *Moon is the Oldest TV* reframe; "two viewpoints, one subject — a stereoscope."
- **Page 1 — two rooftops:** the Boston (winter) and Santiago (summer) rooftop photographs side-by-side
  (stacked when narrow), the "separated by a season" story, and a compact live `StatRow`
  (baseline / Moon distance / parallax 1.18°).
- **Page 2 — implementation:** the alt-az derotation + shared-baseline pipeline in brief, then how to see it
  (wiggle default; TAB / SPACE / F; CONTROLS for glasses modes).

Details: `INTRODUCTION_PAGE_COUNT = 3` (`state.ts`). The card is single-column, `min(600px, 100vw-32px)`,
`max-height: calc(100dvh - 132px)` with internal scroll, over a faint radial scrim. Rooftop images live in
`frontend/public/images/` (`rooftop-boston.jpg`, `rooftop-santiago.jpg` — resized to 1100px wide, ~90 KB each,
from the website repo's `rooftop-boston-snow.jpg` / `rooftop-santiago-summer.jpg`). The per-eye telemetry
overlay (`EyeOverlay`) is hidden while the card is open (`App.tsx`) so the modal reads clean. The old
two-column / camera card-lift machinery (`introductionCardHeight`, `applyCardLift`) is now unused by the
pop-up but remains for the dormant diagram intro.
