import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createMirewake } from "./mirewakeModel.mjs";

// Original models built from shared, small geometries. No downloaded models,
// textures, shadow maps, physics engine or postprocessing in the world renderer.
export function modelKit() {
  const materials = new Map(),
    geometries = new Map();
  function material(color, glow = false) {
    const key = `${color}:${glow}`;
    if (!materials.has(key))
      materials.set(
        key,
        glow
          ? new THREE.MeshBasicMaterial({ color })
          : new THREE.MeshStandardMaterial({
              color,
              roughness: 1,
              flatShading: true,
            }),
      );
    return materials.get(key);
  }
  function geo(kind) {
    if (!geometries.has(kind))
      geometries.set(
        kind,
        kind === "box"
          ? new THREE.BoxGeometry(1, 1, 1)
          : kind === "cone"
            ? new THREE.ConeGeometry(1, 1, 5)
            : kind === "rock"
              ? new THREE.IcosahedronGeometry(1, 0)
              : new THREE.CylinderGeometry(1, 1, 1, 8),
      );
    return geometries.get(kind);
  }
  function part(
    parent,
    kind,
    color,
    pos,
    scale,
    rotation = [0, 0, 0],
    glow = false,
  ) {
    const m = new THREE.Mesh(geo(kind), material(color, glow));
    m.position.set(...pos);
    m.scale.set(...scale);
    m.rotation.set(...rotation);
    parent.add(m);
    return m;
  }
  const box = (p, c, at, size, r) => part(p, "box", c, at, size, r);
  function tree(parent, x, z, size = 1, seed = 0) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = seed;
    part(g, "cylinder", "#657c59", [0.2, 0.012, 0.12], [0.75, 0.018, 0.56]);
    part(g, "cylinder", "#66543c", [0, 0.8, 0], [0.15, 1.6, 0.15]);
    for (let i = 0; i < 3; i++)
      part(
        g,
        "cone",
        ["#355b46", "#497454", "#64835b"][i],
        [0, 1.3 + i * 0.48, 0],
        [1 - i * 0.17, 1.4, 0.85 - i * 0.13],
      );
    g.scale.setScalar(size);
    parent.add(g);
    return g;
  }
  function log(parent, at, length = 1.5, rotation = 0) {
    const g = new THREE.Group();
    g.position.set(...at);
    g.rotation.y = rotation;
    part(
      g,
      "cylinder",
      "#715139",
      [0, 0, 0],
      [0.23, length, 0.23],
      [0, 0, Math.PI / 2],
    );
    for (const s of [-1, 1]) {
      part(
        g,
        "cylinder",
        "#d8b97f",
        [s * (length / 2 + 0.005), 0, 0],
        [0.21, 0.025, 0.21],
        [0, 0, Math.PI / 2],
      );
      part(
        g,
        "cylinder",
        "#a27a4c",
        [s * (length / 2 + 0.022), 0, 0],
        [0.11, 0.026, 0.11],
        [0, 0, Math.PI / 2],
      );
    }
    parent.add(g);
    return g;
  }
  function house(parent, at, roof = "#a96548", scale = 1) {
    const g = new THREE.Group();
    g.position.set(...at);
    g.scale.setScalar(scale);
    part(g, "cylinder", "#667b5a", [0.3, 0.015, 0.2], [1.55, 0.02, 1.2]);
    box(g, "#cec093", [0, 0.85, 0], [1.85, 1.7, 1.5]);
    box(g, "#67543c", [0, 0.1, 0], [2.05, 0.2, 1.7]);
    for (const s of [-1, 1]) {
      box(g, roof, [s * 0.52, 1.95, 0], [1.4, 0.18, 1.95], [0, 0, -s * 0.58]);
      box(g, "#66503a", [s * 0.82, 0.9, 0.78], [0.12, 1.8, 0.1]);
      box(g, "#f7d182", [s * 0.51, 1.02, 0.77], [0.34, 0.4, 0.04]);
    }
    box(g, "#514938", [0, 0.5, 0.78], [0.43, 0.9, 0.08]);
    box(g, "#8a8064", [0.6, 2.3, -0.35], [0.32, 0.8, 0.35]);
    parent.add(g);
    return g;
  }
  function wheel(parent, at, radius = 0.8) {
    const g = new THREE.Group();
    g.position.set(...at);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.11, 4, 12),
      material("#664936"),
    );
    g.add(ring);
    for (let i = 0; i < 6; i++)
      box(
        g,
        "#b79864",
        [0, 0, 0],
        [0.08, radius * 2, 0.09],
        [0, 0, (i * Math.PI) / 6],
      );
    part(
      g,
      "cylinder",
      "#dac08b",
      [0, 0, 0],
      [0.16, 0.3, 0.16],
      [Math.PI / 2, 0, 0],
    );
    parent.add(g);
    return g;
  }
  function cart(parent, at = [0, 0, 0]) {
    const g = new THREE.Group();
    g.position.set(...at);
    box(g, "#7f5839", [0, 0.65, 0], [1.45, 0.22, 1.9]);
    for (let i = 0; i < 3; i++)
      for (const s of [-1, 1])
        box(g, "#b98c54", [s * 0.72, 0.82 + i * 0.19, 0], [0.12, 0.15, 1.9]);
    for (const x of [-0.86, 0.86])
      for (const z of [-0.61, 0.61])
        wheel(g, [x, 0.48, z], 0.4).rotation.y = Math.PI / 2;
    for (let i = 0; i < 3; i++)
      box(g, "#d5b976", [(i - 1) * 0.4, 1.12, 0], [0.35, 0.4, 1.65]);
    for (const x of [-0.5, 0.5])
      box(g, "#77573b", [x, 0.65, -1.7], [0.09, 0.09, 1.8]);
    parent.add(g);
    return g;
  }
  function dragon(parent, at = [0, 0, 0]) {
    return createMirewake(parent, at, batchScenery);
  }
  function dispose(root) {
    const gs = new Set(geometries.values()),
      ms = new Set(materials.values());
    root.traverse((o) => {
      if (o.geometry) gs.add(o.geometry);
      if (o.material)
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
          ms.add(m),
        );
    });
    gs.forEach((g) => g.dispose());
    ms.forEach((m) => m.dispose());
  }
  return {
    part,
    box,
    tree,
    log,
    house,
    wheel,
    cart,
    dragon,
    material,
    dispose,
  };
}

// Bake static scenery by material: hundreds of little parts become a handful
// of draws. Animated props are kept outside this group.
export function batchScenery(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (geometry.index) {
      const flat = geometry.toNonIndexed();
      geometry.dispose();
      if (!buckets.has(o.material)) buckets.set(o.material, []);
      buckets.get(o.material).push(flat);
    } else {
      if (!buckets.has(o.material)) buckets.set(o.material, []);
      buckets.get(o.material).push(geometry);
    }
  });
  const result = new THREE.Group();
  for (const [material, parts] of buckets) {
    const geometry = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    if (geometry) result.add(new THREE.Mesh(geometry, material));
  }
  // Unique custom geometries in the discarded hierarchy are not shared.
  const custom = new Set();
  group.traverse((o) => {
    if (
      o.geometry &&
      [
        "TorusGeometry",
        "ExtrudeGeometry",
        "BufferGeometry",
        "RingGeometry",
      ].includes(o.geometry.type)
    )
      custom.add(o.geometry);
  });
  custom.forEach((g) => g.dispose());
  return result;
}

export function ribbon(points, width, color, kit, y = 0.025) {
  const vertices = [],
    indices = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      prev = points[Math.max(0, i - 1)],
      next = points[Math.min(points.length - 1, i + 1)];
    const dx = next[0] - prev[0],
      dz = next[1] - prev[1],
      length = Math.hypot(dx, dz) || 1;
    for (const sign of [-1, 1])
      vertices.push(
        p[0] - ((dz / length) * width * sign) / 2,
        y,
        p[1] + ((dx / length) * width * sign) / 2,
      );
    if (i) {
      const n = i * 2;
      indices.push(n - 2, n - 1, n, n - 1, n + 1, n);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  // Paths must be visible from above; the strip's winding is upward.
  return new THREE.Mesh(g, kit.material(color));
}
