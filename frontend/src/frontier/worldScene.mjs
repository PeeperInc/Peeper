import * as THREE from "three";
import content from "../../../backend/frontier/content.json";
import roads from "../../../backend/frontier/roads.json";
import { modelKit, batchScenery, ribbon } from "./lowPolyWorld.mjs";

export const WORLD_SIZE = 36;
export const worldPoint = ([x, y]) => [
  (x - 0.5) * WORLD_SIZE,
  (y - 0.5) * WORLD_SIZE,
];
export function createWorldScene(bridge) {
  const scene = new THREE.Scene(),
    kit = modelKit(),
    ground = new THREE.Group();
  scene.background = new THREE.Color("#879e8c");
  scene.fog = new THREE.Fog("#879e8c", 48, 95);
  scene.add(new THREE.HemisphereLight("#fff2cb", "#4d675a", 2.5));
  const sun = new THREE.DirectionalLight("#ffe3ac", 3);
  sun.position.set(-12, 25, 8);
  scene.add(sun);
  kit.box(ground, "#4c827c", [0, -0.65, 0], [62, 0.4, 62]);
  function island(points, top) {
    const shape = new THREE.Shape();
    points.forEach((p, i) => {
      const [x, z] = worldPoint(p);
      i ? shape.lineTo(x, -z) : shape.moveTo(x, -z);
    });
    shape.closePath();
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.8, bevelEnabled: false }),
      kit.material(top),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.8;
    ground.add(mesh);
  }
  island(
    [
      [-0.15, -0.15],
      [0.62, -0.15],
      [0.65, 0.1],
      [0.6, 0.3],
      [0.6, 0.39],
      [0.58, 0.52],
      [0.53, 0.7],
      [0.49, 0.85],
      [0.48, 1.15],
      [-0.15, 1.15],
    ],
    "#829570",
  );
  island(
    [
      [0.78, -0.15],
      [1.15, -0.15],
      [1.15, 1.15],
      [0.64, 1.15],
      [0.65, 0.87],
      [0.7, 0.7],
      [0.74, 0.53],
      [0.74, 0.43],
      [0.76, 0.25],
    ],
    "#798d66",
  );
  for (let i = 0; i < 42; i++) {
    const y = ((i * 73) % 997) / 997,
      x = 0.62 - y * 0.06 + Math.sin(y * 8) * 0.025,
      [wx, wz] = worldPoint([x + 0.055, y]);
    kit.box(
      ground,
      i % 3 ? "#74a29a" : "#9ab6a0",
      [wx, -0.43, wz],
      [0.35 + (i % 4) * 0.12, 0.012, 0.025],
    );
  }
  const roadSegments = [];
  for (const [from, to, gate, between] of roads.edges) {
    if (gate) continue;
    const points = [roads.nodes[from], ...between, roads.nodes[to]].map(
      worldPoint,
    );
    ground.add(ribbon(points, 1.16, "#776e4d", kit, 0.024));
    ground.add(ribbon(points, 0.92, "#dec596", kit, 0.034));
    for (const [x, z] of points)
      kit.part(
        ground,
        "cylinder",
        "#dec596",
        [x, 0.032, z],
        [0.46, 0.015, 0.46],
      );
    for (let i = 1; i < points.length; i++)
      roadSegments.push([points[i - 1], points[i]]);
  }
  if (bridge)
    for (const [from, to, gate, between] of roads.edges) {
      if (!gate) continue;
      const points = [roads.nodes[from], ...between, roads.nodes[to]].map(
        worldPoint,
      );
      for (let i = 1; i < points.length; i++) {
        roadSegments.push([points[i - 1], points[i]]);
        const a = points[i - 1],
          b = points[i],
          distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.ceil(distance / 0.3);
        for (let j = 0; j < steps; j++) {
          const t = j / steps;
          kit.box(
            ground,
            j % 3 ? "#b49a6a" : "#d0b580",
            [a[0] + (b[0] - a[0]) * t, 0.11, a[1] + (b[1] - a[1]) * t],
            [0.85, 0.17, (distance / steps) * 0.93],
            [0, Math.atan2(b[0] - a[0], b[1] - a[1]), 0],
          );
        }
        for (const p of [a, b])
          for (const side of [-0.5, 0.5])
            kit.box(
              ground,
              "#756044",
              [p[0] + side, 0.43, p[1]],
              [0.12, 0.95, 0.12],
            );
      }
    }
  function distanceToPath(x, z, a, b) {
    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      t = Math.max(
        0,
        Math.min(
          1,
          ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1),
        ),
      );
    return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
  }
  for (let i = 0; i < 180; i++) {
    const nx = ((i * 137.3 + 37) % 1000) / 1000,
      ny = ((i * 263.7 + 91) % 1000) / 1000;
    if (nx > 0.51 - Math.max(0, ny - 0.5) * 0.1 && nx < 0.79) continue;
    if (!bridge && nx > 0.6) continue;
    const [x, z] = worldPoint([nx, ny]);
    if (
      content.locations.some((l) => Math.hypot(nx - l.x, ny - l.y) < 0.075) ||
      roadSegments.some(([a, b]) => distanceToPath(x, z, a, b) < 0.75)
    )
      continue;
    if (i % 5) kit.tree(ground, x, z, 0.48 + (i % 7) * 0.085, i);
    else kit.part(ground, "rock", "#89947a", [x, 0.17, z], [0.42, 0.35, 0.5]);
  }
  // Marsh plants, stepping stones and small islands break up the broad terrain.
  for (let i = 0; i < 130; i++) {
    const nx = ((i * 83.71 + 43) % 1000) / 1000,
      ny = ((i * 179.29 + 23) % 1000) / 1000;
    if ((nx > 0.48 && nx < 0.8) || (!bridge && nx > 0.6)) continue;
    const [x, z] = worldPoint([nx, ny]);
    if (
      content.locations.some((l) => Math.hypot(nx - l.x, ny - l.y) < 0.06) ||
      roadSegments.some(([a, b]) => distanceToPath(x, z, a, b) < 0.5)
    )
      continue;
    if (i % 4 === 0)
      kit.part(
        ground,
        "cylinder",
        "#748768",
        [x, 0.025, z],
        [0.6, 0.025, 0.38],
      );
    else
      for (let j = 0; j < 3; j++) {
        kit.part(
          ground,
          "cone",
          i % 3 ? "#6b865c" : "#b0ad76",
          [x + j * 0.1, 0.2 + j * 0.05, z],
          [0.055, 0.4 + j * 0.1, 0.055],
          [0, 0, (j - 1) * 0.3],
        );
        if (i % 7 === 0)
          kit.part(
            ground,
            "rock",
            "#d5ba7b",
            [x + j * 0.1, 0.48 + j * 0.05, z],
            [0.065, 0.13, 0.065],
          );
      }
  }
  const animated = [];
  function site(id, build) {
    const l = content.locations.find((l) => l.id === id),
      [x, z] = worldPoint([l.x, l.y]);
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    ground.add(g);
    build(g, x, z);
  }
  site("village", (g) => {
    kit.house(g, [-1.2, 0, -1.1], "#a8614a");
    kit.house(g, [1.2, 0, 0.1], "#b7834d", 0.67);
    kit.box(g, "#786343", [0, 0.15, 1.1], [3, 0.3, 1.2]);
    for (let i = 0; i < 5; i++)
      kit.box(g, "#d5b27a", [0, 0.35 + i * 0.14, 1.1], [2.3, 0.11, 0.7]);
    kit.cart(g, [2, 0, 1.5]).scale.setScalar(0.6);
    kit.part(g, "cone", "#f4b75c", [-1.2, 0.3, 1.2], [0.18, 0.6, 0.18]);
  });
  site("sawmill", (g, x, z) => {
    kit.house(g, [0, 0, -1], "#688273", 1.15);
    for (let i = 0; i < 5; i++)
      kit.log(
        g,
        [(i % 2) * 0.45 - 1.7, 0.25 + Math.floor(i / 2) * 0.32, 1],
        2.2,
        0.15,
      );
    const w = kit.wheel(scene, [x + 1.5, 1.1, z - 0.9], 0.92);
    animated.push([w, "wheel"]);
    kit.box(g, "#c5af7e", [0.1, 0.5, 1.3], [1.4, 0.16, 0.7]);
  });
  site("quarry", (g) => {
    for (let i = 0; i < 8; i++)
      kit.part(
        g,
        "rock",
        i % 2 ? "#8d9789" : "#697b77",
        [
          ((i % 3) - 1) * 0.9,
          0.35 + Math.floor(i / 3) * 0.26,
          Math.floor(i / 3) * 0.45 - 0.5,
        ],
        [0.65, 0.65, 0.65],
      );
    for (let i = 0; i < 4; i++)
      kit.part(
        g,
        "rock",
        "#a8d5cc",
        [(i - 1.5) * 0.4, 0.7, -0.7],
        [0.16, 0.4, 0.16],
      );
    for (const x of [-1.7, 1.7])
      kit.box(g, "#766144", [x, 1.3, 0.7], [0.2, 2.6, 0.2]);
    kit.box(g, "#b49c67", [0, 2.5, 0.7], [3.7, 0.25, 0.25]);
  });
  site("bridge", (g) => {
    kit.box(g, "#a18b60", [-0.3, 0.12, 0], [1.5, 0.24, 1]);
    for (let i = 0; i < 4; i++)
      kit.log(g, [-0.5, 0.3 + i * 0.22, 1.4], 1.5, 0.35);
    if (!bridge)
      for (let i = 0; i < 3; i++)
        kit.box(
          g,
          "#ae9768",
          [0.7 + i * 0.35, 0.05, -0.05 + i * 0.14],
          [0.28, 0.15, 1],
          [0, 0.3, 0],
        );
  });
  if (bridge) {
    site("mill", (g, x, z) => {
      kit.house(g, [-0.5, 0, 0], "#97704f", 1.15);
      const wind = new THREE.Group();
      wind.position.set(x - 0.5, 2.7, z + 1.05);
      for (let i = 0; i < 4; i++)
        kit.box(
          wind,
          "#ddcca0",
          [
            Math.sin((i * Math.PI) / 2) * 0.75,
            Math.cos((i * Math.PI) / 2) * 0.75,
            0,
          ],
          [0.24, 1.5, 0.12],
          [0, 0, (-i * Math.PI) / 2],
        );
      scene.add(wind);
      animated.push([wind, "wheel"]);
      for (let i = 0; i < 3; i++)
        kit.box(g, "#bca46a", [1.1, 0.25 + i * 0.37, 0.5], [0.7, 0.34, 0.6]);
    });
    site("workshop", (g) => {
      kit.house(g, [0, 0, -0.5], "#485f65", 1.1);
      kit.box(g, "#777b6e", [-1.3, 0.6, 1.1], [0.7, 1.2, 0.6]);
      kit.box(g, "#c2c2a2", [-1.3, 1.22, 1.1], [1.3, 0.25, 0.65]);
      kit.box(g, "#edb466", [0.8, 0.5, 0.6], [0.5, 0.35, 0.2]);
    });
    site("pool", (g, x, z) => {
      kit.part(g, "cylinder", "#3c6e66", [0, 0.04, 0], [3, 0.08, 2.2]);
      const dragon = kit.dragon(scene, [x, 0.1, z]);
      dragon.rotation.y = 0.55;
      animated.push([dragon, "dragon"]);
      for (let i = 0; i < 9; i++)
        kit.part(
          g,
          "rock",
          "#71846a",
          [Math.cos(i * 0.7) * 2.7, 0.2, Math.sin(i * 0.7) * 2.1],
          [0.4, 0.3, 0.4],
        );
    });
  } else {
    for (let i = 0; i < 18; i++)
      kit.part(
        ground,
        "rock",
        i % 2 ? "#a6b6a1" : "#95aa97",
        [
          (0.8 + (i % 3) * 0.1 - 0.5) * 36,
          0.15,
          (Math.floor(i / 3) * 0.21 - 0.5) * 36,
        ],
        [3.8, 0.75, 3.3],
      );
  }
  scene.add(batchScenery(ground));
  return {
    scene,
    kit,
    update(time, reduced) {
      for (const [o, kind] of animated) {
        if (kind === "wheel") o.rotation.z = reduced ? 0 : time * 0.22;
        else o.userData.animate?.(time, { reduced });
      }
    },
    dispose() {
      kit.dispose(scene);
    },
  };
}
