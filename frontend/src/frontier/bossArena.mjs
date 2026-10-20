import * as THREE from "three";
import { batchScenery } from "./lowPolyWorld.mjs";

// A flooded shrine, built once and merged by material. No textures or shadows.
export function createBossArena(scene, kit, lanes) {
  const g = new THREE.Group(),
    stone = "#587f7c",
    edge = "#2d5258",
    pale = "#9cac8e",
    moss = "#667b52",
    water = "#174e5b",
    gold = "#e5bb72";
  // Frame the actual court, excluding the water plane and distant vegetation.
  const framingPoints = [];
  function framePart(mesh) {
    mesh.updateMatrixWorld(true);
    const vertices = mesh.geometry.attributes.position;
    for (let i = 0; i < vertices.count; i++)
      framingPoints.push(
        new THREE.Vector3()
          .fromBufferAttribute(vertices, i)
          .applyMatrix4(mesh.matrixWorld),
      );
    return mesh;
  }
  const box = (c, p, s, r) => framePart(kit.box(g, c, p, s, r));
  const disk = (c, p, s) => framePart(kit.part(g, "cylinder", c, p, s));
  kit.part(g, "cylinder", water, [0, -0.5, 0], [24, 0.14, 24]);
  disk(edge, [0, -0.29, -0.65], [3.85, 0.4, 3.85]);
  disk(stone, [0, -0.06, -0.65], [3.65, 0.08, 3.65]);
  // The concentric broken paving makes the dragon's dais a recognizable place.
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8,
      x = Math.cos(a),
      z = Math.sin(a);
    box(
      i % 3 ? pale : moss,
      [x * 3.3, 0.015, -0.65 + z * 3.3],
      [0.62, 0.055, 0.25],
      [0, -a + Math.PI / 2, 0],
    );
    box(
      edge,
      [x * 2.65, 0.005, -0.65 + z * 2.65],
      [0.38, 0.045, 0.08],
      [0, -a + Math.PI / 2, 0],
    );
  }
  for (const [index, lane] of lanes.entries()) {
    disk(edge, [lane.x, -0.25, lane.z], [1.46, 0.45, 1.4]);
    disk(pale, [lane.x, -0.005, lane.z], [1.31, 0.08, 1.25]);
    disk(stone, [lane.x, 0.04, lane.z], [1.15, 0.025, 1.09]);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      kit.part(
        g,
        "box",
        "#95d5be",
        [lane.x + Math.cos(a) * 0.97, 0.063, lane.z + Math.sin(a) * 0.91],
        [0.17, 0.018, 0.06],
        [0, -a, 0],
        true,
      );
    }
    // Steps and a short causeway connect both dodge platforms to the shrine.
    for (let i = 0; i < 3; i++)
      box(
        i % 2 ? pale : stone,
        [
          lane.x + (index ? -0.12 : 0.12) * i,
          -0.03 - i * 0.035,
          lane.z - 1.05 - i * 0.46,
        ],
        [0.9, 0.16, 0.4],
        [0, index ? -0.12 : 0.12, 0],
      );
    box(edge, [lane.x, -0.04, lane.z + 1.3], [1, 0.18, 0.5]);
    box(pale, [lane.x, 0.045, lane.z + 1.3], [0.88, 0.035, 0.4]);
  }
  // Low remnants frame the field without hiding either landing platform.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const z = -3.6 + i * 1.05;
      box(edge, [side * 4.45, -0.12, z], [0.9, 0.35, 0.92]);
      box(
        i % 2 ? stone : pale,
        [side * 4.45, 0.22, z],
        [0.76, 0.35 + (i % 2) * 0.15, 0.78],
        [0, side * 0.04, 0],
      );
      if (i % 2 === 0) box(moss, [side * 4.45, 0.45, z], [0.8, 0.06, 0.8]);
    }
    for (let i = 0; i < 4; i++) {
      const x = side * (2.5 + (i % 2) * 0.3),
        z = -5.4 + Math.floor(i / 2) * 0.2;
      box(
        i % 2 ? stone : pale,
        [x, 0.32 + i * 0.53, z],
        [0.85 - i * 0.03, 0.5, 0.8],
      );
    }
    box(pale, [side * 2.5, 2.65, -5.3], [1.1, 0.26, 1]);
    // Torn expedition banners, contrasting warm cloth and teal stone.
    box("#564e3d", [side * 3.7, 1.4, -3.6], [0.07, 2.85, 0.07]);
    box(gold, [side * 3.7, 2.8, -3.6], [0.82, 0.07, 0.08]);
    box(
      side > 0 ? "#b7744f" : "#38958c",
      [side * 3.7, 2.22, -3.57],
      [0.68, 1.08, 0.035],
    );
    box(gold, [side * 3.7, 2.27, -3.54], [0.08, 0.64, 0.02]);
    for (let i = 0; i < 6; i++) {
      const x = side * (5 + i * 0.42),
        z = 2.5 - i * 1.5;
      kit.part(
        g,
        "rock",
        i % 2 ? moss : edge,
        [x, -0.12, z],
        [0.8, 0.45, 0.6],
        [0, i, 0],
      );
      for (let j = 0; j < 3; j++)
        kit.part(
          g,
          "cone",
          j % 2 ? "#83a471" : moss,
          [x + j * 0.16, 0.2, z],
          [0.06, 0.9 + j * 0.15, 0.05],
          [0, 0, side * 0.18],
        );
    }
    for (let i = 0; i < 5; i++)
      kit.tree(
        g,
        side * (6.5 + (i % 2)),
        -6 - i * 1.4,
        0.95 + (i % 3) * 0.16,
        i,
      );
  }
  box(stone, [0, 2.7, -5.35], [4.4, 0.45, 0.85]);
  box(moss, [-0.6, 2.96, -5.35], [3.2, 0.08, 0.9]);
  // Torch bowls sit behind the player's pads, clear of the dodge path.
  const torchPositions = [-1, 1].map(
    (side) => new THREE.Vector3(side * 3.55, 0.92, 1.25),
  );
  for (const p of torchPositions) {
    disk(edge, [p.x, 0.05, p.z], [0.4, 0.15, 0.4]);
    disk(pale, [p.x, 0.46, p.z], [0.21, 0.8, 0.21]);
    disk("#66583f", [p.x, 0.86, p.z], [0.38, 0.17, 0.38]);
    disk("#ffb65e", [p.x, 0.97, p.z], [0.27, 0.04, 0.27]);
  }
  scene.add(batchScenery(g));
  const flames = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1, 1, 5),
    new THREE.MeshBasicMaterial({ color: "#ffcc77" }),
    6,
  );
  scene.add(flames);
  const dummy = new THREE.Object3D();
  const ripples = new THREE.Group();
  const rippleGeo = new THREE.RingGeometry(0.96, 1, 32),
    rippleMat = new THREE.MeshBasicMaterial({
      color: "#73afac",
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  for (const p of lanes)
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(rippleGeo, rippleMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, -0.39, p.z);
      ring.userData.offset = i * Math.PI;
      ripples.add(ring);
    }
  scene.add(ripples);
  return {
    framingPoints,
    animate(time, reduced) {
      let n = 0;
      for (const p of torchPositions)
        for (let i = 0; i < 3; i++) {
          const flicker = reduced
            ? 0.5
            : 0.5 + Math.sin(time * (6 + i) + i) * 0.22;
          dummy.position.set(p.x + (i - 1) * 0.12, p.y + 0.15 + i * 0.06, p.z);
          dummy.scale.set(
            0.16 - i * 0.025,
            0.4 + flicker * 0.25,
            0.16 - i * 0.025,
          );
          dummy.rotation.z = reduced ? 0 : Math.sin(time * 5 + i) * 0.12;
          dummy.updateMatrix();
          flames.setMatrixAt(n++, dummy.matrix);
        }
      flames.instanceMatrix.needsUpdate = true;
      ripples.children.forEach((r) =>
        r.scale.setScalar(
          1.65 + (reduced ? 0 : Math.sin(time * 0.8 + r.userData.offset) * 0.2),
        ),
      );
    },
  };
}
