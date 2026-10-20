import * as THREE from "three";
import { modelKit, batchScenery } from "./lowPolyWorld.mjs";

export function createFieldScene(mode, challenge) {
  const kit = modelKit(),
    scene = new THREE.Scene(),
    staticGroup = new THREE.Group(),
    dynamic = new THREE.Group();
  scene.background = new THREE.Color("#7f9986");
  scene.fog = new THREE.Fog("#7f9986", 20, 70);
  scene.add(new THREE.HemisphereLight("#e5f2ee", "#304c48", 2.3));
  const sun = new THREE.DirectionalLight("#fff0d4", 2.7);
  sun.position.set(-5, 12, 8);
  scene.add(sun);
  scene.add(dynamic);
  const travelling = ["convoy", "duel"].includes(mode);
  if (!travelling) {
    scene.background.set(mode === "mining" ? "#637c78" : "#93a488");
    scene.fog.color.copy(scene.background);
    kit.part(
      staticGroup,
      "cylinder",
      mode === "mining" ? "#5c7169" : "#8b9266",
      [0, -0.015, 0],
      [4, 0.035, 3.4],
    );
    for (let i = 0; i < 32; i++) {
      const angle = i * 2.399,
        radius = 3 + (i % 5) * 0.65,
        x = Math.cos(angle) * radius,
        z = Math.sin(angle) * radius;
      kit.part(
        staticGroup,
        "rock",
        i % 3 ? "#65785b" : "#c7bd8c",
        [x, 0.055, z],
        [0.09 + (i % 3) * 0.06, 0.05, 0.13],
        [0, angle, 0],
      );
      if (i % 3 === 0)
        for (let j = 0; j < 3; j++)
          kit.part(
            staticGroup,
            "cone",
            "#506e4c",
            [x + j * 0.12, 0.2, z],
            [0.045, 0.45 + j * 0.08, 0.045],
            [0.2, 0, (j - 1) * 0.2],
          );
    }
  }
  const camera = new THREE.PerspectiveCamera(travelling ? 47 : 40, 1, 0.1, 100);
  camera.position.set(
    ...(mode === "convoy"
      ? [0, 7, 11]
      : mode === "duel"
        ? [0, 8, 14]
        : [7, 8, 11]),
  );
  camera.lookAt(
    ...(mode === "convoy"
      ? [0, 0, -8]
      : mode === "duel"
        ? [0, 0.6, -3]
        : [0, 0.6, 0]),
  );
  kit.box(
    staticGroup,
    "#758860",
    [0, -0.3, travelling ? -15 : 0],
    [travelling ? 32 : 18, 0.5, travelling ? 90 : 18],
  );
  const shadows = [];
  function shadow(x, z, scale) {
    const m = kit.part(
      staticGroup,
      "cylinder",
      "#5f7357",
      [x, 0.015, z],
      [scale, 0.015, scale * 0.7],
    );
    shadows.push(m);
  }
  const nodes = [],
    targets = [],
    pieces = [],
    fx = [];
  let tool, body, dragon, cart, halo, trailMarks;
  function axe() {
    const g = new THREE.Group();
    kit.box(g, "#a57f4e", [0, 0, 0], [0.13, 1.8, 0.13]);
    if (mode === "mining") {
      kit.box(g, "#b9c8bc", [0, 0.7, 0], [1.3, 0.16, 0.2]);
      kit.part(
        g,
        "cone",
        "#d4deca",
        [-0.68, 0.6, 0],
        [0.11, 0.55, 0.11],
        [0, 0, -0.8],
      );
    } else {
      kit.box(g, "#aeb9ae", [0.22, 0.7, 0], [0.8, 0.42, 0.16]);
      kit.box(g, "#dde1c4", [0.57, 0.7, 0], [0.1, 0.45, 0.18]);
    }
    dynamic.add(g);
    return g;
  }
  if (mode === "logging") {
    for (let i = 0; i < 4; i++)
      kit.box(
        staticGroup,
        "#8c744c",
        [2.4 + i * 0.24, 0.12, 1.3],
        [0.2, 0.2, 2.6],
        [0, -0.15, 0],
      );
    for (let i = 0; i < 3; i++)
      kit.part(
        staticGroup,
        "cylinder",
        i % 2 ? "#765c3d" : "#bfa173",
        [0, 1.07, 0],
        [1.08 - i * 0.25, 0.015, 0.89 - i * 0.2],
      );
    kit.tree(staticGroup, -5, -4, 1.5, 2);
    kit.tree(staticGroup, 4, -4, 1.8, 4);
    kit.tree(staticGroup, -4, 3, 1, 1);
    kit.part(staticGroup, "cylinder", "#76563a", [0, 0.5, 0], [1.3, 1, 1.1]);
    kit.part(
      staticGroup,
      "cylinder",
      "#c3a16b",
      [0, 1.02, 0],
      [1.26, 0.07, 1.06],
    );
    for (let i = 0; i < 6; i++)
      pieces.push(kit.log(dynamic, [(i - 2.5) * 0.38, 1.32, 0], 0.36, 0));
    for (let i = 0; i < 5; i++)
      kit.log(
        staticGroup,
        [-2.8 + (i % 2) * 0.5, 0.3 + Math.floor(i / 2) * 0.4, -1.7],
        1.5,
        0.2,
      );
    body = new THREE.Group();
    body.position.set(-1.35, 0, 1.8);
    dynamic.add(body);
    body.rotation.y = -0.4;
    for (const x of [-1.35, 1.35])
      targets.push(
        kit.part(
          dynamic,
          "cone",
          "#ffdd82",
          [x, 1.3, 0.2],
          [0.22, 0.5, 0.22],
          [0, 0, x < 0 ? -Math.PI / 2 : Math.PI / 2],
          true,
        ),
      );
    tool = axe();
    shadow(0, 0, 1.7);
  }
  if (mode === "mining") {
    if (challenge.arcade.touch) {
      kit.part(staticGroup, "rock", "#617875", [0, 0.65, 0], [2.2, 1.3, 2]);
      for (let i = 0; i < 7; i++)
        kit.part(
          staticGroup,
          "rock",
          i % 2 ? "#435d59" : "#7e8f7c",
          [
            Math.sin(i * 1.7) * 3,
            0.4 + (i % 3) * 0.3,
            -2.6 - Math.cos(i) * 0.7,
          ],
          [0.7, 0.6, 0.8],
          [0, i, 0],
        );
      [
        [-1.1, 1.2, 0.7],
        [0.8, 1.5, 0.1],
        [0.35, 0.7, 1.7],
      ].forEach((at) => {
        const g = new THREE.Group();
        g.position.set(...at);
        kit.part(
          g,
          "cone",
          "#b7e4d0",
          [0, 0.15, 0],
          [0.2, 0.6, 0.2],
          [0, 0, 0.25],
        );
        dynamic.add(g);
        for (let i = 0; i < 3; i++)
          kit.box(
            g,
            "#263f3c",
            [(i - 1) * 0.18, 0.02, 0.12],
            [0.04, 0.025, 0.6],
            [0, (i - 1) * 0.6, 0],
          );
        nodes.push(g);
      });
    } else {
      kit.box(staticGroup, "#5c6b61", [0, -0.03, 0], [8, 0.18, 6]);
      for (let i = 0; i < 9; i++)
        kit.part(
          staticGroup,
          "rock",
          i % 2 ? "#68776c" : "#78877b",
          [
            ((i % 3) - 1) * 3,
            1 + Math.floor(i / 3) * 0.35,
            -3.4 - Math.floor(i / 3) * 0.35,
          ],
          [1.8, 1.5, 1.2],
        );
      challenge.arcade.nodes.forEach((type, i) => {
        const g = new THREE.Group();
        g.position.set(((i % 3) - 1) * 2.35, 0, Math.floor(i / 3) * 2.7 - 1.4);
        dynamic.add(g);
        if (type === "brace") {
          for (const side of [-1, 1])
            kit.box(g, "#bba171", [side * 0.45, 0.65, 0], [0.16, 1.3, 0.2]);
          kit.box(g, "#debd7e", [0, 1.3, 0], [1.2, 0.2, 0.3]);
          kit.box(g, "#876c47", [0, 0.65, 0], [0.12, 1.5, 0.12], [0, 0, -0.55]);
        } else {
          kit.part(
            g,
            "rock",
            type === "ore" ? "#6a7c79" : "#966f59",
            [0, 0.45, 0],
            [0.9, 0.6, 0.8],
          );
          for (let j = 0; j < 3; j++)
            kit.part(
              g,
              type === "ore" ? "cone" : "box",
              type === "ore" ? "#b0dfcf" : "#d29a75",
              [(j - 1) * 0.3, 0.95 + (j % 2) * 0.1, -0.1],
              [0.18, type === "ore" ? 0.65 : 0.12, 0.2],
              [0, 0, (j - 1) * 0.3],
            );
        }
        nodes.push(g);
      });
    }
    halo = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.06, 32),
      new THREE.MeshBasicMaterial({ color: "#ffe5a0", side: THREE.DoubleSide }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.12;
    dynamic.add(halo);
    tool = axe();
  }
  if (mode === "convoy") {
    kit.box(staticGroup, "#b7a276", [0, 0.01, -20], [9, 0.1, 70]);
    for (let i = 0; i < 32; i++) {
      const side = i % 2 ? 1 : -1,
        z = -i * 2.2;
      kit.tree(staticGroup, side * (5.5 + (i % 3)), z, 0.8 + (i % 4) * 0.2, i);
    }
    const marks = new THREE.Group();
    for (let i = 0; i < 35; i++)
      for (const x of [-1.5, 1.5])
        kit.box(marks, "#cdbb8a", [x, 0.07, -i * 2.2], [0.07, 0.02, 0.8]);
    trailMarks = batchScenery(marks);
    dynamic.add(trailMarks);
    cart = kit.cart(dynamic);
    cart.rotation.y = Math.PI;
    body = new THREE.Group();
    body.position.set(0, 0.9, -0.45);
    cart.add(body);
    challenge.arcade.rows.forEach((row) => {
      const stump = new THREE.Group(),
        crate = new THREE.Group();
      kit.part(stump, "cylinder", "#805b3d", [0, 0.4, 0], [0.62, 0.8, 0.62]);
      kit.part(stump, "cylinder", "#d1af73", [0, 0.82, 0], [0.59, 0.05, 0.59]);
      for (let i = 0; i < 3; i++)
        kit.part(
          stump,
          "cone",
          "#7a5b3d",
          [Math.cos(i * 2.1) * 0.5, 0.15, Math.sin(i * 2.1) * 0.5],
          [0.3, 0.6, 0.3],
          [0, 0, 0.7],
        );
      kit.box(crate, "#deba6f", [0, 0.52, 0], [1, 1, 1]);
      for (const x of [-0.32, 0.32])
        kit.box(crate, "#826d48", [x, 0.52, 0.51], [0.1, 1, 0.04]);
      kit.box(crate, "#f4db94", [0, 1.05, 0], [0.3, 0.04, 0.3]);
      dynamic.add(stump, crate);
      nodes.push({ stump, crate, row });
    });
  }
  if (mode === "duel") {
    kit.part(staticGroup, "cylinder", "#5d7b60", [0, 0.01, -3], [7, 0.1, 9]);
    for (let i = 0; i < 20; i++) {
      const a = (i * Math.PI * 2) / 20;
      kit.part(
        staticGroup,
        "rock",
        "#879074",
        [Math.cos(a) * 7, 0.25, -3 + Math.sin(a) * 9],
        [0.6, 0.5, 0.7],
      );
      if (i % 3 === 0)
        kit.tree(staticGroup, Math.cos(a) * 9, -3 + Math.sin(a) * 11, 0.9, i);
    }
    dragon = kit.dragon(dynamic, [0, 0, -8]);
    dragon.rotation.y = Math.PI / 2;
    dragon.scale.setScalar(1.35);
    body = new THREE.Group();
    body.position.set(0, 0, 2);
    dynamic.add(body);
    body.rotation.y = Math.PI;
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.025, 8),
        new THREE.MeshBasicMaterial({
          color: "#ffe2a0",
          transparent: true,
          opacity: 0,
        }),
      );
      m.position.set((i - 1) * 3, 0.1, 0);
      dynamic.add(m);
      targets.push(m);
    }
  }
  // Reusable little chips, never allocated in the animation loop.
  for (let i = 0; i < 16; i++)
    fx.push(
      kit.part(
        dynamic,
        "rock",
        mode === "mining" ? "#abd8c5" : "#dbb97b",
        [0, -10, 0],
        [0.08, 0.08, 0.08],
      ),
    );
  const scenery = batchScenery(staticGroup);
  scene.add(scenery);
  let lastFlash = -1;
  return {
    peeperAnchor: body,
    hop(height) {
      if (cart) cart.position.y = height;
    },
    scene,
    camera,
    kit,
    nodes,
    update(s, time, reduced) {
      const a = challenge.arcade,
        power = s.charging ? Math.min(1.2, (s.t - s.chargeStarted) / 1000) : 0;
      const flash = s.flash,
        age = flash ? (s.t - flash.t) / 1000 : 10;
      if (flash && flash.t !== lastFlash) {
        lastFlash = flash.t;
      }
      if (mode === "logging") {
        pieces.forEach((o, i) => {
          const cut = i < s.cutsMade;
          o.position.y = cut ? 0.35 : 1.32;
          o.position.z = cut ? 1.8 + i * 0.15 : 0;
          o.rotation.y = cut ? i * 0.43 : 0;
        });
        targets.forEach((m, i) => {
          m.visible = !s.done && i === a.notches[s.cutsMade];
          m.position.y = 1.35 + (reduced ? 0 : Math.sin(time * 5) * 0.09);
        });
        const side = s.toolSide === 0 ? -1 : 1;
        tool.position.set(side * (0.65 + power * 0.4), 2 + power * 0.8, 0.5);
        tool.rotation.z = side * (-0.4 - power * 0.7);
        if (age < 0.22) {
          tool.position.y -= Math.sin((age / 0.22) * Math.PI) * 1.5;
          tool.rotation.z += side * Math.sin((age / 0.22) * Math.PI) * 0.9;
        }
        body.rotation.z = s.charging ? side * 0.08 : 0;
      }
      if (mode === "mining") {
        nodes.forEach((o, i) => {
          const hp = s.rockHP[i],
            type = a.nodes[i];
          o.scale.setScalar(
            !hp
              ? type === "brace"
                ? 1.05
                : 0.25
              : hp === 1 && type === "ore"
                ? 0.8
                : 1,
          );
        });
        const n = nodes[s.selectedNode];
        halo.position.x = n.position.x;
        halo.position.z = n.position.z;
        tool.position.set(n.position.x + 0.6, 2.1 + power, n.position.z + 0.8);
        tool.rotation.z = -0.5 - power * 0.7;
        if (age < 0.24)
          tool.position.y -= Math.sin((age / 0.24) * Math.PI) * 1.6;
        scene.background.set(s.stress > 0.8 ? "#89765d" : "#637c78");
      }
      if (mode === "convoy") {
        trailMarks.position.z = (s.t * 0.012) % 2.2;
        cart.position.x = (s.x - 0.5) * 10.714;
        cart.position.y = reduced ? 0 : Math.sin(time * 21) * 0.035;
        cart.rotation.z = -(challenge.arcade.balance
          ? s.balance * 0.28
          : (s.targetX - s.x) * 1.5);
        nodes.forEach(({ stump, crate, row }, i) => {
          const z = -(row.at + 1800 - s.t) * 0.012;
          stump.position.set((row.obstacle - 1) * 3, 0, z);
          crate.position.set((row.crate - 1) * 3, 0, z);
          stump.visible = crate.visible =
            !s.crossed.includes(i) && z > -38 && z < 5;
        });
      }
      if (mode === "duel") {
        const attack = a.attacks.find(
            (attack) => s.t >= attack.at - 1100 && s.t <= attack.at + 850,
          ),
          diff = attack ? s.t - attack.at : -10000;
        body.position.x = (s.x - 0.5) * 10.714;
        targets.forEach((m, i) => {
          m.material.color.set(
            diff < 0 ? (i === attack?.safe ? "#e6d788" : "#ba7155") : "#c5dfa0",
          );
          m.material.opacity = attack
            ? diff < 0
              ? 0.14 + (reduced ? 0 : Math.sin(time * 10) * 0.05)
              : i === attack.safe
                ? 0.25
                : 0
            : 0;
        });
        dragon.position.z =
          diff >= -180 && diff < 260
            ? -8 + Math.sin(((diff + 180) / 440) * Math.PI) * 6
            : -8;
        dragon.position.y = reduced ? 0 : Math.sin(time * 1.5) * 0.03;
        dragon.userData.animate?.(time, {
          reduced,
          windup: diff < 0 && diff > -1000 ? 1 + diff / 1000 : 0,
        });
        body.rotation.z =
          age < 0.2 && !flash?.bad ? Math.sin((age / 0.2) * Math.PI) * 0.3 : 0;
      }
      fx.forEach((m, i) => {
        m.visible = age < 0.5 && !reduced;
        if (!m.visible) return;
        const origin =
          mode === "mining"
            ? nodes[flash.node]?.position
            : mode === "convoy"
              ? cart.position
              : mode === "duel"
                ? body.position
                : { x: 0, z: 0 };
        const t = age,
          angle = i * 2.4;
        m.position.set(
          (origin?.x || 0) + Math.cos(angle) * t * 3,
          1 + t * (2 + (i % 3)) - t * t * 8,
          (origin?.z || 0) + Math.sin(angle) * t * 3,
        );
        m.rotation.set(t * 5, i, t * 3);
      });
    },
    dispose() {
      kit.dispose(scene);
    },
  };
}
