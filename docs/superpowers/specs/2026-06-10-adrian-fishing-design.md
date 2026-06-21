# Adrian Fishing 3D Mini-Game Design

## Goal

Add a lightweight 3D Telegram Mini App game inspired by the Adrian atmospheric sampling sequence from *Project Hail Mary*. The player keeps the Hail Mary at a safe angle and speed while a xenonite chain lowers a collector into Adrian's atmosphere.

## Player Experience

- Session length: about 45 seconds.
- Orientation: portrait mobile.
- Input: one virtual two-axis control.
- Horizontal movement adjusts the ship angle.
- Vertical movement adjusts thrust and lateral speed.
- The ship follows a predefined flight path; the player does not freely navigate in 3D.
- Maintaining the safe ranges fills the sample collector.
- Incorrect input increases heat and chain stress instead of ending the run immediately.
- Rocky provides short directional hints and positive reactions through a portrait HUD.

## Scene Composition

- The optimized Hail Mary model is the foreground gameplay object.
- Adrian fills the lower/background portion of the scene and rotates very slowly relative to the ship.
- A xenonite chain extends from the ship toward the planet.
- A separate collector model hangs at the end of the chain inside the atmospheric sampling layer.
- The camera remains constrained to a cinematic side/three-quarter view so the ship, chain, collector, and planet remain readable on a narrow phone.
- The chain visually bends and vibrates in response to angle, speed, heat, and stress values.

## Adrian Visual Direction

Adrian should resemble the supplied film reference rather than a green Earth:

- dark olive and emerald surface colors;
- blue water shifted toward dark green/cyan;
- minimal visible ice or white polar regions;
- dense yellow-green clouds that hide much of the surface;
- brighter acid-yellow cloud highlights on the lit side;
- deep green shadow regions;
- a thick, vivid green atmospheric rim;
- restrained orange-yellow highlights near the strongest illumination.

The source FBX geometry remains usable, but its original scene hierarchy, camera, light, skeleton-driven rotation, and atmosphere material are not part of the runtime asset.

## Planet Asset Pipeline

- Use the original FBX only as the geometry source.
- Preserve the ground and cloud UV layouts.
- Regrade the ground diffuse texture toward Adrian's palette.
- Remove or suppress the Earth-like white polar appearance.
- Regrade the cloud texture to yellow-green while retaining its alpha and swirling forms.
- Downscale runtime textures from `4096x2048` to mobile-friendly sizes.
- Keep the ground normal map only if it remains visibly useful from the final gameplay camera.
- Rebuild clouds as one or two independent spheres slightly larger than the ground sphere.
- Build the atmospheric rim in Three.js with a Fresnel-style additive shader rather than baking it into the GLB.
- Rotate the planet and cloud layers independently at very low speeds for visual life, not physical orbital simulation.

## Mobile Asset Budget

- Shipping format: GLB/glTF 2.0.
- Planet geometry target: no more than the current approximately `48,000` triangles.
- Ground diffuse: `2048x1024`.
- Primary cloud map: `2048x1024` with alpha.
- Optional secondary cloud/noise map: at most `1024x512`.
- Ground normal map: at most `1024x512`, and omitted if visually unnecessary.
- Target planet GLB size: approximately `2-4 MB`.
- The atmospheric shader and optional secondary cloud sphere are created at runtime and do not need to be embedded in the GLB.

## Runtime Architecture

- Use React Three Fiber because the existing frontend is React/Vite and the game must share app lifecycle state with the existing game menu.
- Keep simulation state outside the Three.js scene graph.
- Use a lazy-loaded game chunk so Three.js and the 3D assets are not downloaded until the player opens the game.
- Use a single WebGL canvas and DOM HUD.
- Clamp device pixel ratio to a maximum of `1.5`.
- Prefer baked/material lighting and one directional light; no real-time shadows.
- Pause animation and rendering when the game is closed or the document is hidden.
- Use simplified mathematical chain movement rather than full rigid-body physics.

## Gameplay State

The simulation tracks:

- `angle`: current ship angle correction;
- `thrust`: current player thrust input;
- `speed`: smoothed lateral speed;
- `chainDeflection`: derived from angle and speed error;
- `heat`: rises when the flight path is too low or the chain approaches exhaust;
- `chainStress`: rises from excessive speed and abrupt corrections;
- `sampleProgress`: rises while angle, speed, heat, and chain stress remain within safe limits;
- `timeRemaining`: round countdown.

The run ends when time expires or when an emergency threshold is reached. A partial sample still grants a reduced result so the game remains forgiving on touch devices.

## Rocky HUD

- Use the supplied Rocky illustration as a compact portrait.
- Convert it to a transparent WebP before shipping.
- Show only one short line at a time.
- Hints describe the correction rather than explaining equations: increase thrust, reduce thrust, raise the nose, lower the nose, stabilize, or celebrate.
- Dialogue is original game text inspired by Rocky's speaking style, not copied passages from the book.

## Mobile Flight Director

- Rocky sits in the upper-left playfield directly below the compact HUD so his guidance never competes with the thumb control.
- The joystick is centered along the bottom safe area and no longer contains the moving target marker, because the player's thumb obscures that location.
- A lightweight lime flight-director reticle is rendered around the Hail Mary itself. Its horizontal position, vertical position, and tilt represent the required angle and thrust.
- The player moves the ship into the reticle rather than reading a separate instrument. The reticle brightens when the ship is correctly aligned.
- The ship visibly responds to both control axes: angle changes lateral position and tilt, while thrust changes vertical position.

## Validation

- Test the optimized planet and ship on low-end Android hardware inside Telegram WebView.
- Confirm stable interaction at a capped 30 FPS baseline and allow 60 FPS on capable devices.
- Verify that the planet, chain, and ship remain readable at the smallest supported portrait viewport.
- Measure compressed download size, decoded texture memory, draw calls, and frame time.
- Verify that leaving the game stops its render loop and external Home Screen polling remains suspended.

## Licensing Requirement

Before public deployment, verify that the ship, planet, and Rocky image licenses permit redistribution and use in the game. Store required attribution in the project documentation and user-facing credits if the licenses require it.
