# Interactive dental experience: source mapping and handoff

The landing experience contains Three.js enamel meshes, a reflective ocean surface and the Rubik interaction adapted from the supplied archives. The hero is a constructed anatomical sculpture; its geometry is not a scan or a manufacturing specification for a factory product.

## Source mapping

| Supplied source | Integrated files | Retained and extended behaviour |
| --- | --- | --- |
| `landingpage(1).zip` → `liquid-dental-experience/src/tooth.js` | `engines/tooth.ts`, `engines/anatomy.ts` | Continuous field meshing, cached shared geometry and physical enamel. Separate upper molar with four unequal rounded cusp facets and three curved roots, and lower molar with five facets and two flattened roots; asymmetric crown shoulders, marginal/oblique ridges, fossa, branching fissures, filled cervical root trunk, subdued root warmth and minute enamel relief. |
| `landingpage(1).zip` → `liquid-dental-experience/src/hero.js` | `engines/hero.ts`, `engines/dynamics.ts` | Direct tooth picking, point-preserving dragging, release velocity and orbit. Rebuilt around fixed-step gravity, distributed displacement, damping, crown contacts, occasional wave-driven tipping and an interruptible visible return pointer. |
| `landingpage(1).zip` → `liquid-dental-experience/src/liquid-water.js` | `engines/liquid-water.ts`, `engines/ocean-math.ts` | Three's planar Reflector pipeline and pointer/impact interaction. The surface now shares an analytic directional gravity-wave spectrum, asymmetric second-harmonic crests and expanding impact packets with the CPU buoyancy sampler. Fine filtered normals, sparse moving foam and a deep open-ocean optical model extend the original reflector. |
| `landingpage(1).zip` → `liquid-dental-experience/src/rubik.js` | `engines/rubik.ts` | Original integer cubie lattice, drag-driven layer turns, move queue, inverse/undo/reset logic and automatic orbit. The anatomical tooth remains attached to its actual upper cubie and follows layer turns. |
| `Luma-Liquid-Glass-v2-login-page(1).zip` → `Luma-Dental/dist/tooth-scene.js` | `engines/auth.ts` | Independent Luma mascot geometry, convex eyes and pupils, pointer tracking, blinking, privacy hands, orbit and theme lighting. This engine does not import the hero anatomy, so changes to molar root bounds do not move the mascot's face. |

All engine paths above are relative to `src/components/experience/`. Navigation, carousel, content and dashboard samples are mapped in the project-level design provenance.

## React interfaces

```tsx
import ToothExperience from '@/components/experience/ToothExperience';
import RubikExperience from '@/components/experience/RubikExperience';

<ToothExperience variant="hero" theme={theme} locale={locale} showHint />
<ToothExperience variant="auth" theme={theme} locale={locale}
  authMode="login" privacy={passwordFocused} />
<RubikExperience theme={theme} locale={locale} />
```

`ToothExperience` also accepts `className` and `ariaLabel`. `privacy` affects only the mascot's hands. Account validation, masking and session state remain in the account/provider components.

The original `tooth.ts` mesher, `rubik.ts` lattice engine and `auth.ts` mascot retain `@ts-nocheck` around the adapted source. The React boundaries and the new hero, ocean, anatomy, physics, environment and clock modules are typed. No iframe or unrelated standalone demonstration is embedded.

## Light, reflections and contact

The local `/media/environment/blue-lagoon-1k.hdr` asset is **Blue Lagoon, Greg Zaal, CC0-1.0**. `docs/ENVIRONMENT-ASSET.json` contains the original source, license, local path and checksum. It supplies surface illumination/reflections only and is not represented as a factory landscape.

`environment.ts` uses Three's current `HDRLoader` (the successor to `RGBELoader`) and PMREM. A procedural cloud environment is available immediately; the original Rubik studio is retained as that component's immediate fallback. The local HDR loads asynchronously. Loading failure leaves the fallback usable, and a result that arrives after disposal is released without touching the scene.

The strongest upper-hemisphere HDR sample determines the directional light. The enamel reflections, water sun glint and actual shadow-casting key therefore share the same light direction. The ocean and visible sky use the original HDR; enamel uses its filtered PMREM. The open-water sky samples only above the recorded coastal horizon, so the stage does not introduce a photographed shoreline or imply a factory location. Theme changes alter sky exposure and illumination while retaining a natural sea palette.

### Solid tooth shape and surface

The current crown surface is assembled from unequal rounded sloping cusp facets, with individual positions, heights, widths, depths and angles. These replace the previous summed Gaussian bumps. A rhomboidal upper crown and a longer, tapered lower crown have distinct buccal grooves, shoulders, marginal ridges and developmental fissures. A filled cervical root trunk connects the crown to the divergent roots; the geometry is a continuous closed solid surface, with space between the roots below the furcation.

The user-supplied **Ideal Makoo branded recovered mould guide**, `enigmalife-mould-chart-pdf-Recovered2222-Recovered.pdf`, page 14 (“Posterior Teeth”), was inspected for crown contour, cusp asymmetry and enamel/body tone. Its original SHA-256 is `a17af8e145c595ec8760f346210efe0a8d66698b3a0df05bb5cd9afa1cc03f1d`. It is available in the public document collection as `/media/documents/ideal-makoo-mould-guide-web.pdf#page=14`. The artificial-tooth photographs do not establish root anatomy, and the recovered filename is not used to infer a different brand identity.

Enamel uses Three's physical material over a dominantly opaque ivory body. A vertex surface attribute distinguishes crown, cervical/root area and grooves. View-dependent, limited volume transmission softens thin-looking edges without turning the entire tooth into glass; the root remains nearly opaque and subtly warmer. Roughness, clearcoat and minute curved-neck/irregular microrelief vary across the surface. The anatomical geometry stays responsible for large highlights and shadows. This is authored visual material shading, not a measured biological optical model or a scanned factory product.

### Open-water rendering

The surface uses a shared six-direction gravity-wave spectrum with bounded second-harmonic crest sharpening. The same height derivatives drive GPU normals and CPU buoyancy. Fine wind-aligned capillary normals are attenuated by pixel footprint near the horizon, reducing fine-pattern shimmer. Actual planar enamel reflection, Fresnel, wavelength-dependent absorption, deep blue-green body color, restrained sun glints, short-lived impact foam and sparse broken crest flecks replace the earlier shallow-bed/cyan appearance. No neon color is added to the water shader.

A nonuniform grid concentrates geometry around tooth interactions while extending to an open horizon. Atmospheric distance haze and the real HDR sky supply continuity at the edge of the view. Actual cast shadows ground the root/water contact, and partial water opacity leaves submerged root portions visible. The Rubik plinth continues to receive actual cubie and tooth shadows. Reflection/refraction and foam remain bounded surface approximations rather than a volumetric fluid solver.

## Interaction and return sequence

The hero uses the full canvas as its drag field. A tooth retains the exact point where it was grabbed. Lifting and releasing preserve bounded pointer velocity and angular momentum. Empty-space dragging or the right mouse button orbits the camera. Automatic orbit resumes from the current angle after user interaction; it does not reset the camera angle on release.

The body solver runs at 120 Hz. Its buoyancy probes lie inside the same anatomical field used for the visible mesh. Gravity, submerged volume, relative water velocity, angular damping and crown contact determine release behaviour. The solid display meshes use an effective low mass and low centre of gravity chosen for this floating interaction. This art direction is not a claim that biological teeth or factory products float in water, and it does not remove the filled crown/root geometry.

While the scene is visible and idle, an occasional passing-wave episode can gently tip one tooth. The initial episode is eligible after 12.5 seconds; later episodes are separated by 30–38 seconds and require quiet bodies. Completing a pointer or keyboard gesture postpones the next episode by at least 16 seconds. A smooth, bounded angular acceleration packet changes velocity only; it never writes a preset position or quaternion. Its water packet and force direction agree. Episodes do not start during a grab, orbit, assisted return, hidden state, disabled assistance or reduced motion. User interaction cancels an active force packet.

The visible pointer label is exactly **Ai Agent**. It is a deterministic frontend interaction, with no remote AI call. Its phases are approach, grip, lift, carry, lower, release and departure. During approach the tooth continues to float. The pointer selects a camera-visible crown surface and stays attached to that local point. At grip the return plan captures the current position and quaternion. Quintic segment easing gives continuous lift/carry/lower boundaries and a gentle landing. A wave-tipped tooth uses a shorter lift for straightening; a displaced tooth has more clearance for relocation. Destination quaternions are placed in the source hemisphere, including the last frame, to preserve the shortest rotation across the ±180° boundary. Grabbing an assisted tooth interrupts the sequence at its current pose; Escape also clears queued assistance.

All visible gesture instructions are provided in Persian, English, Arabic, Turkish and Russian. Hero keyboard controls are:

- `1` / `2`: choose the tooth.
- Arrow up: lift; arrow down: release downward; left/right: nudge.
- `Shift` + arrow keys: orbit.
- `R`, `Home` or `Enter`: request a gentle return.
- `Escape`: release the current grab or interrupt assistance.

Rubik face dragging rotates a layer. Dragging its tooth, empty space or with the right mouse button orbits the complete sculpture. Its original keyboard face notation (`R L U D F B`, with Shift for an inverse), arrows, Backspace undo, Home reset and Space orbit toggle remain available. There are no visible play controls.

## Lifecycle and bounded work

- Engines are lazy imported near the viewport. The host owns requestAnimationFrame and the scene clock.
- `scene-clock.ts` discards hidden/offscreen time. A paused return or layer animation resumes from the same pose, with no large catch-up delta.
- Reduced motion disables new autonomous tipping episodes, ambient orbit and swells. Direct gestures retain gravity/response; accumulated deltas keep the 10 Hz reduced render schedule from slowing explicit physics. A settled reduced-motion hero stops decorative body motion.
- The hero fills its available width and height with no scene card frame, width cap or faded canvas edge. Each canvas resizes from its own bounds; camera distance protects both teeth on narrow screens. Below 720 px initial width, the hero selects standard geometry, a 128-segment water grid and 1024-pixel shadows; wider stages use high geometry, 176 water segments and 1536-pixel shadows. Pixel density and reflection targets are capped. Water mirror updates are bounded at approximately 40 Hz, or 10 Hz under reduced motion, and recursive transmission-pass captures are excluded.
- Mesh geometry is reference-counted by quality and morphology. Material instances remain independent.
- Unmount removes pointer/keyboard/media/visibility listeners and observers, cancels frames, releases mesh/material/shadow/reflection/environment resources, and disposes the renderer/context. Late HDR completion is guarded.
- The wrappers expose a vector fallback for unavailable/lost WebGL contexts. The hero loading state does not flash the vector substitute before the real scene appears.

## Verification

Run the actual-source math/state suite with:

```bash
node --test --test-isolation=none tests/experience.test.mjs
```

The 25 tests cover closed high-detail meshes, topology and finite normals; solid cervical/crown fields and asymmetric cusps; reference-counted disposal; analytical water derivatives including sharpened crests; expanding/decaying bounded impacts; reduced-motion water; spherical-cap volume; freefall and rotation; stable buoyant settling; equal physics at 60/30/10 Hz render schedules; contact momentum/energy; continuous assisted returns; hidden/resumed clocks; accumulated reduced-motion deltas; and exact Rubik quarter turns/inverses.

New balance tests verify visibility/reduced-motion/user-cooldown gating, finite smooth force endpoints, no direct pose writes, a visible bounded lean for both actual anatomical buoyancy fields, continuous capture and recovery from the resulting fluid pose, uninterrupted user takeover, and shortest-arc quaternion continuity across the ±180° sign boundary.

Shader bindings were reviewed against the installed Three shader chunks and Reflector implementation. These tests do not claim GPU rendering or browser visual verification. The managed workflow does not provide an approved browser-control skill, so no preview server, browser automation or browser-based visual workaround was used.
