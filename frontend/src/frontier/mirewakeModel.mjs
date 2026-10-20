import * as THREE from "three";

// An original, articulated model. Static surfaces are baked by material in each
// joint, so scales and wing ribs do not each require a draw call.
export function createMirewake(parent, at, bake) {
  const root = new THREE.Group();
  root.name = "Mirewake";
  const owned = new Set(),
    materials = new Map();
  const colors = {
    hide: "#285f59",
    flank: "#39786c",
    ridge: "#568b76",
    dark: "#214b48",
    belly: "#c8a16c",
    plate: "#a58b61",
    horn: "#ebd9ab",
    hornBase: "#9a906c",
    wing: "#a37250",
    wingLight: "#c49b68",
    wingDark: "#815948",
    mouth: "#472e32",
    eye: "#ffbd57",
    pupil: "#172f31",
  };
  function material(color, side = THREE.FrontSide) {
    const key = `${color}:${side}`;
    if (!materials.has(key))
      materials.set(
        key,
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.82,
          flatShading: true,
          side,
          ...(color === colors.eye
            ? { emissive: color, emissiveIntensity: 0.65 }
            : {}),
        }),
      );
    return materials.get(key);
  }
  const sphere = new THREE.IcosahedronGeometry(1, 1);
  owned.add(sphere);
  function mesh(
    group,
    geometry,
    color,
    position = [0, 0, 0],
    size = [1, 1, 1],
    rotation = [0, 0, 0],
    side,
  ) {
    const m = new THREE.Mesh(geometry, material(color, side));
    m.position.set(...position);
    m.scale.set(...size);
    m.rotation.set(...rotation);
    group.add(m);
    return m;
  }
  function oval(group, color, position, size, rotation) {
    return mesh(group, sphere, color, position, size, rotation);
  }
  function tube(group, color, path, radii, sides = 8) {
    const points = path.map((p) => new THREE.Vector3(...p));
    const vertices = [],
      indices = [];
    const axis = new THREE.Vector3(),
      normal = new THREE.Vector3(),
      binormal = new THREE.Vector3();
    points.forEach((p, i) => {
      axis
        .subVectors(
          points[Math.min(points.length - 1, i + 1)],
          points[Math.max(0, i - 1)],
        )
        .normalize();
      normal
        .crossVectors(
          axis,
          Math.abs(axis.y) > 0.9
            ? new THREE.Vector3(0, 0, 1)
            : new THREE.Vector3(0, 1, 0),
        )
        .normalize();
      binormal.crossVectors(axis, normal).normalize();
      for (let j = 0; j < sides; j++) {
        const a = (j * Math.PI * 2) / sides;
        const v = p
          .clone()
          .addScaledVector(normal, Math.cos(a) * radii[i])
          .addScaledVector(binormal, Math.sin(a) * radii[i]);
        vertices.push(v.x, v.y, v.z);
        if (i) {
          const n = i * sides + j,
            next = i * sides + ((j + 1) % sides);
          indices.push(n - sides, next - sides, n, next - sides, next, n);
        }
      }
    });
    for (let j = 1; j < sides - 1; j++) indices.push(0, j + 1, j);
    const end = (points.length - 1) * sides;
    for (let j = 1; j < sides - 1; j++) indices.push(end, end + j, end + j + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    owned.add(g);
    return mesh(group, g, color);
  }
  function bone(group, color, from, to, r1, r2 = r1) {
    return tube(group, color, [from, to], [r1, r2]);
  }
  function horn(group, path, radius = 0.13, color = colors.horn) {
    tube(
      group,
      color,
      path,
      path.map((_, i) => radius * (1 - i / (path.length - 1))),
      6,
    );
  }
  function joint(build, position = [0, 0, 0]) {
    const raw = new THREE.Group();
    build(raw);
    const g = new THREE.Group();
    g.add(bake(raw));
    g.position.set(...position);
    root.add(g);
    return g;
  }

  const torso = joint((g) => {
    oval(g, colors.hide, [-0.12, 1.1, 0], [1.42, 0.85, 1.0]);
    oval(g, colors.flank, [0.85, 0.98, 0], [0.92, 0.72, 0.8]);
    oval(g, colors.belly, [-0.5, 0.66, 0], [0.74, 0.37, 0.65]);
    tube(
      g,
      colors.hide,
      [
        [-0.7, 1.25, 0],
        [-1.02, 1.6, 0],
        [-1.16, 1.95, 0],
        [-1.55, 2.12, 0],
      ],
      [0.66, 0.54, 0.45, 0.36],
    );
    for (let i = 0; i < 4; i++) {
      oval(
        g,
        i % 2 ? colors.plate : colors.belly,
        [-1.1 - i * 0.08, 1.25 + i * 0.2, 0],
        [0.26, 0.16, 0.46 - i * 0.025],
        [0, 0, -0.3],
      );
    }
    for (const side of [-1, 1]) {
      // Weight-bearing shoulders, bent elbows, broad feet and separate claws.
      oval(
        g,
        colors.flank,
        [-0.7, 1.03, side * 0.73],
        [0.49, 0.62, 0.42],
        [side * 0.2, 0, -0.2],
      );
      tube(
        g,
        colors.hide,
        [
          [-0.75, 0.95, side * 0.8],
          [-0.9, 0.48, side * 1.04],
          [-1.25, 0.23, side * 1.13],
        ],
        [0.31, 0.26, 0.21],
      );
      oval(g, colors.dark, [-1.38, 0.19, side * 1.12], [0.47, 0.21, 0.35]);
      oval(
        g,
        colors.flank,
        [-1.12, 0.43, side * 1.09],
        [0.25, 0.34, 0.26],
        [0, 0, -0.4],
      );
      oval(g, colors.flank, [0.98, 0.77, side * 0.72], [0.65, 0.62, 0.47]);
      tube(
        g,
        colors.hide,
        [
          [1.2, 0.75, side * 0.85],
          [1.48, 0.4, side * 1.02],
          [1.12, 0.18, side * 1.2],
        ],
        [0.34, 0.27, 0.19],
      );
      oval(g, colors.dark, [0.98, 0.17, side * 1.23], [0.45, 0.19, 0.32]);
      oval(
        g,
        colors.flank,
        [1.23, 0.36, side * 1.14],
        [0.25, 0.3, 0.26],
        [0, 0, 0.3],
      );
      for (let i = -1; i <= 1; i++) {
        horn(
          g,
          [
            [-1.53, 0.21, side * 1.12 + i * 0.19],
            [-1.78, 0.12, side * 1.12 + i * 0.21],
            [-1.94, 0.1, side * 1.12 + i * 0.22],
          ],
          0.1,
        );
        horn(
          g,
          [
            [0.81, 0.2, side * 1.23 + i * 0.18],
            [0.56, 0.11, side * 1.23 + i * 0.2],
            [0.43, 0.09, side * 1.23 + i * 0.21],
          ],
          0.09,
        );
      }
      for (let i = 0; i < 5; i++)
        oval(
          g,
          colors.ridge,
          [-0.4 + i * 0.36, 1.4 - (i % 2) * 0.07, side * (0.8 - i * 0.05)],
          [0.23, 0.17, 0.1],
          [0, 0, -0.4],
        );
    }
    for (let i = 0; i < 6; i++) {
      const x = -0.65 + i * 0.4,
        y = 1.85 - Math.max(0, i - 1) * 0.1;
      horn(
        g,
        [
          [x, y, 0],
          [x + 0.14, y + 0.39 - i * 0.025, 0],
          [x + 0.35, y + 0.51 - i * 0.04, 0],
        ],
        0.17,
        colors.hornBase,
      );
    }
  });

  const head = joint(
    (g) => {
      oval(g, colors.flank, [0, 0, 0], [0.68, 0.49, 0.53]);
      oval(g, colors.hide, [-0.6, -0.12, 0], [0.7, 0.3, 0.43]);
      oval(g, colors.ridge, [-0.96, -0.08, 0], [0.27, 0.19, 0.37]);
      oval(g, colors.mouth, [-0.6, -0.37, 0], [0.62, 0.08, 0.4]);
      for (const side of [-1, 1]) {
        oval(
          g,
          colors.eye,
          [-0.29, 0.13, side * 0.455],
          [0.15, 0.095, 0.065],
          [0, 0, -0.2],
        );
        oval(
          g,
          colors.pupil,
          [-0.34, 0.13, side * 0.515],
          [0.045, 0.077, 0.025],
        );
        oval(
          g,
          colors.horn,
          [-0.38, 0.17, side * 0.529],
          [0.025, 0.025, 0.009],
        );
        bone(
          g,
          colors.dark,
          [-0.56, 0.25, side * 0.45],
          [0.03, 0.36, side * 0.46],
          0.095,
          0.14,
        );
        oval(
          g,
          colors.dark,
          [-1.02, 0.01, side * 0.29],
          [0.095, 0.052, 0.047],
          [0, 0, -0.2],
        );
        horn(
          g,
          [
            [0.18, 0.33, side * 0.32],
            [0.43, 0.72, side * 0.48],
            [0.78, 0.98, side * 0.52],
            [1.08, 1.1, side * 0.46],
          ],
          0.16,
        );
        horn(
          g,
          [
            [0.3, 0.12, side * 0.4],
            [0.64, 0.36, side * 0.72],
            [0.92, 0.48, side * 0.82],
          ],
          0.13,
          colors.hornBase,
        );
        for (let i = 0; i < 3; i++)
          oval(
            g,
            colors.ridge,
            [0.22 + i * 0.13, -0.07 - i * 0.1, side * 0.46],
            [0.14, 0.19, 0.07],
            [0, 0, -0.5],
          );
        for (let i = 0; i < 3; i++)
          horn(
            g,
            [
              [-0.4 - i * 0.24, -0.36, side * 0.3],
              [-0.43 - i * 0.24, -0.57, side * 0.3],
            ],
            0.055,
          );
      }
      horn(
        g,
        [
          [-0.3, 0.36, 0],
          [-0.05, 0.7, 0],
          [0.2, 0.81, 0],
        ],
        0.14,
        colors.hornBase,
      );
    },
    [-1.58, 2.12, 0],
  );
  const rawJaw = new THREE.Group();
  oval(rawJaw, colors.flank, [-0.5, -0.07, 0], [0.68, 0.14, 0.36]);
  oval(rawJaw, colors.belly, [-0.43, -0.145, 0], [0.5, 0.08, 0.28]);
  oval(rawJaw, colors.hide, [-0.04, -0.08, 0], [0.3, 0.21, 0.42]);
  const jaw = new THREE.Group();
  jaw.add(bake(rawJaw));
  jaw.position.set(-0.05, -0.47, 0);
  head.add(jaw);

  const wings = [];
  for (const side of [-1, 1]) {
    const wing = joint(
      (g) => {
        const wrist = [-0.55, 1.05, side * 1.55];
        const tips = [
          [-0.23, 1.15, side * 2.85],
          [0.8, 0.7, side * 2.8],
          [1.6, 0.12, side * 2.15],
          [1.6, -0.35, side * 1.2],
          [0.95, -0.35, side * 0.22],
        ];
        const outline = [];
        tips.forEach((p, i) => {
          outline.push(p);
          if (i < tips.length - 1) {
            const next = tips[i + 1];
            outline.push([
              (p[0] + next[0]) * 0.5 - 0.13,
              (p[1] + next[1]) * 0.5 - 0.18,
              (p[2] + next[2]) * 0.5 - side * 0.2,
            ]);
          }
        });
        for (let i = 0; i < outline.length - 1; i++) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(
              [...wrist, ...outline[i], ...outline[i + 1]],
              3,
            ),
          );
          geometry.computeVertexNormals();
          owned.add(geometry);
          mesh(
            g,
            geometry,
            i % 2 ? colors.wing : colors.wingLight,
            [0, 0, 0],
            [1, 1, 1],
            [0, 0, 0],
            THREE.DoubleSide,
          );
        }
        tube(
          g,
          colors.hide,
          [[0, 0, 0], [-0.25, 0.48, side * 0.72], wrist],
          [0.19, 0.15, 0.12],
        );
        tips.forEach((tip, i) => {
          bone(
            g,
            i === 0 ? colors.hornBase : colors.dark,
            wrist,
            tip,
            i === 0 ? 0.085 : 0.055,
            0.025,
          );
          if (i < 2)
            horn(
              g,
              [tip, [tip[0] + 0.04, tip[1] + 0.16, tip[2] + side * 0.12]],
              0.06,
            );
        });
        horn(
          g,
          [wrist, [-0.75, 1.35, side * 1.6], [-0.92, 1.45, side * 1.5]],
          0.11,
        );
      },
      [0.05, 1.62, side * 0.62],
    );
    wings.push([wing, side]);
  }
  const tail = joint((g) => {
    tube(
      g,
      colors.hide,
      [
        [1.05, 0.96, 0],
        [1.8, 0.75, 0.07],
        [2.48, 0.45, 0.4],
        [2.85, 0.32, 1.05],
        [2.65, 0.35, 1.7],
        [2.14, 0.48, 1.98],
        [1.88, 0.72, 1.96],
      ],
      [0.5, 0.37, 0.26, 0.17, 0.12, 0.075, 0],
    );
    for (let i = 0; i < 3; i++) {
      const x = 1.6 + i * 0.42;
      horn(
        g,
        [
          [x, 1.03 - i * 0.16, i * 0.15],
          [x + 0.12, 1.32 - i * 0.18, i * 0.15],
          [x + 0.3, 1.38 - i * 0.2, i * 0.15],
        ],
        0.12,
        colors.hornBase,
      );
    }
  });
  const shadowMat = new THREE.MeshBasicMaterial({
    color: "#102e2c",
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 32), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(2.25, 1.35, 1);
  shadow.position.set(-0.05, 0.035, 0);
  root.add(shadow);
  root.position.set(...at);
  parent.add(root);
  // Only the baked geometry remains attached. Release the source templates.
  owned.forEach((g) => g.dispose());
  root.userData.animate = (
    time,
    { reduced = false, windup = 0, impact = 0, attack = 0, kind = "claw" } = {},
  ) => {
    const breath = reduced ? 0 : Math.sin(time * 1.45);
    torso.scale.y = 1 + breath * 0.012 - windup * 0.035 + attack * 0.04;
    head.rotation.z =
      breath * 0.015 - windup * 0.16 + impact * 0.065 + attack * 0.17;
    head.rotation.y = reduced ? 0 : Math.sin(time * 0.63) * 0.025;
    jaw.rotation.z =
      0.1 +
      windup * 0.24 +
      attack * (kind === "breath" ? 0.3 : 0.12) +
      (reduced ? 0 : Math.max(0, breath) * 0.015);
    for (const [wing, side] of wings)
      wing.rotation.x =
        side *
        (-0.55 +
          (reduced ? 0 : Math.sin(time * 1.1) * 0.025) -
          windup * 0.23 +
          attack * 0.2);
    tail.rotation.y = reduced ? 0 : Math.sin(time * 0.85) * 0.035;
  };
  root.userData.animate(0, { reduced: true });
  root.userData.head = head;
  return root;
}
