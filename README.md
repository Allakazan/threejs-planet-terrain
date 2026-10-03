<div align="center">

# 🪐 threejs-planet-terrain

**A procedural, planet-sized world you can fly a ship around, right in the browser.**

A real-scale planet (R = 2,737 km, 1 unit = 1 m) with quad-sphere LOD terrain,
a floating origin, and a third-person ship that can go from orbit down to the surface.

![React](https://img.shields.io/badge/React_19-20232a?logo=react&logoColor=61dafb)
![Three.js](https://img.shields.io/badge/three.js-000000?logo=threedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript_6-3178c6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646cff?logo=vite&logoColor=white)

</div>

---

## ✨ Features

- **Quad-sphere LOD terrain**: six spherified cube faces, each a quadtree up to 20 levels deep. Chunks are built in a worker pool, and their vertices are stored relative to each chunk so precision holds at ground level.
- **Floating origin**: the render origin follows the player, so the camera always stays near (0, 0, 0) and there's no float jitter, even thousands of kilometres from the planet's centre.
- **Layered terrain**: terrain is described by plain-data specs that stack simplex, ridged, billow, Worley and crater layers, with domain warp and masks. It ships with 12 presets (rocky, earthlike, desert, canyonlands, icy, volcanic, alpine, badlands, shattered, foam, archipelago, flatlands), and a live editor panel lets you tweak them.
- **Ship flight model**: mouse-reticle steering, impulse and cruise speeds, atmospheric drag, roll auto-level and a chargeable hyperdrive.
- **Debug tooling**: an in-shader grid with chunk borders, a HUD with build timings, and a 6DOF free camera.

## 🚀 Getting started

```bash
yarn
yarn dev
```

Then open the URL that Vite prints. `yarn build` makes a production build and `yarn lint` runs ESLint.

## 🎮 Controls

| Key | Action |
| --- | --- |
| **Mouse** | Steer (virtual reticle) |
| **W** / **Shift** | Impulse / cruise |
| **S** | Brake / reverse |
| **A** / **D** | Roll |
| **Space** (hold) | Charge hyperdrive |
| **V** | Toggle free camera (wheel changes speed) |
| **T** | Terrain editor panel |
| **G** | Debug grid and chunk borders |

## 📚 How it works

The design docs explain each system, with the reasoning behind it:

1. [Floating origin & player](docs/01-floating-origin-and-player.md)
2. [Quad-sphere LOD terrain](docs/02-quadsphere-lod-terrain.md)
3. [Ship controller](docs/03-ship-controller.md)
4. [Layered terrain](docs/04-layered-terrain.md)

## 🛣️ Roadmap

- [ ] Skirts to hide cracks between LOD levels
- [ ] Terrain collision and gravity
- [ ] Atmosphere and terrain shading
- [ ] Horizon culling and dynamic near/far planes
- [ ] More planets
