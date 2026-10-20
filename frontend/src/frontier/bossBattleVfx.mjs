import * as THREE from "three";

// Fixed pools: effects reuse their geometry and never add objects during play.
export function createBattleVfx(scene) {
  const sparkGeo = new THREE.IcosahedronGeometry(1, 0),
    dummy = new THREE.Object3D();
  const sparks = new THREE.InstancedMesh(
    sparkGeo,
    new THREE.MeshBasicMaterial({ color: "#ffffff" }),
    24,
  );
  const breath = new THREE.InstancedMesh(
    sparkGeo,
    new THREE.MeshBasicMaterial({ color: "#ffffff" }),
    30,
  );
  const fireColors = ["#ffdb83", "#ff9c4f", "#df5c47"],
    hitColors = ["#fff8cc", "#e6be69", "#96e6d0"];
  for (let i = 0; i < 30; i++)
    breath.setColorAt(i, new THREE.Color(fireColors[i % 3]));
  for (let i = 0; i < 24; i++)
    sparks.setColorAt(i, new THREE.Color(hitColors[i % 3]));
  sparks.frustumCulled = breath.frustumCulled = false;
  scene.add(sparks, breath);
  const slash = new THREE.Group();
  const arcGeo = new THREE.TorusGeometry(0.8, 0.035, 3, 22, Math.PI * 1.35);
  const arcMat = new THREE.MeshBasicMaterial({
    color: "#fff0ba",
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  for (let i = 0; i < 2; i++) {
    const arc = new THREE.Mesh(arcGeo, arcMat);
    arc.rotation.set(0.3, i ? 0.9 : -0.7, i * 1.9);
    slash.add(arc);
  }
  scene.add(slash);
  const claw = new THREE.Group();
  const clawMat = new THREE.MeshBasicMaterial({
    color: "#ffd3aa",
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  for (let i = 0; i < 3; i++) {
    const cut = new THREE.Mesh(arcGeo, clawMat);
    cut.position.set((i - 1) * 0.28, i * 0.1, 0);
    cut.rotation.set(0.4, 0.3, -1);
    claw.add(cut);
  }
  scene.add(claw);
  const shock = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1, 32),
    new THREE.MeshBasicMaterial({
      color: "#f7bf7e",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  shock.rotation.x = -Math.PI / 2;
  scene.add(shock);
  const glow = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.25, 1),
    new THREE.MeshBasicMaterial({
      color: "#ffe7a0",
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  scene.add(glow);
  let event = null;
  const endpoint = new THREE.Vector3(),
    origin = new THREE.Vector3();
  return {
    animate(now, t, attack, lanes, head, fx, reduced) {
      if (attack && attack.remaining <= 0 && (!event || event.id !== attack.id))
        event = {
          id: attack.id,
          kind: attack.kind,
          target: attack.target,
          at: attack.at,
        };
      const age = event ? t - event.at : 100,
        swingAge = (now - fx.swingAt) / 1000,
        swing = swingAge >= 0 && swingAge < 0.38,
        strong = fx.swingKind !== "strike";
      slash.position.copy(head);
      slash.rotation.z = swingAge * 11;
      slash.scale.setScalar(strong ? 1.4 : 0.9);
      slash.visible = swing;
      arcMat.opacity = swing ? Math.sin((swingAge / 0.38) * Math.PI) * 0.95 : 0;
      sparks.visible = swing;
      if (swing) {
        for (let i = 0; i < 24; i++) {
          const a = i * 2.39996,
            spread = swingAge * (strong ? 5 : 3);
          dummy.position.set(
            head.x + Math.cos(a) * spread,
            head.y + Math.sin(a) * spread * 0.65 + 0.25,
            head.z + Math.sin(i * 1.7) * spread * 0.5,
          );
          dummy.scale.setScalar(
            (1 - swingAge / 0.38) * (i % 3 ? 0.045 : 0.085),
          );
          dummy.updateMatrix();
          sparks.setMatrixAt(i, dummy.matrix);
        }
        sparks.instanceMatrix.needsUpdate = true;
      }
      const active = age >= 0 && age < 0.65;
      const target = lanes[event?.target ?? 0];
      claw.visible = active && event.kind !== "breath";
      shock.visible = active;
      claw.position.copy(target);
      claw.position.y = 0.8;
      claw.rotation.z = -age * 3;
      clawMat.opacity =
        active && event.kind !== "breath" ? (1 - age / 0.65) * 0.85 : 0;
      shock.position.set(target.x, 0.08, target.z);
      shock.scale.setScalar(0.7 + Math.max(0, age) * 3);
      shock.material.opacity = active ? (1 - age / 0.65) * 0.7 : 0;
      breath.visible = active && event.kind === "breath";
      if (breath.visible) {
        origin.copy(head);
        origin.y -= 0.25;
        endpoint.copy(target);
        endpoint.y = 0.35;
        for (let i = 0; i < 30; i++) {
          const p = (age * 2.6 + i / 30) % 1,
            radius = 0.09 + p * 0.5,
            a = i * 2.39996;
          dummy.position.lerpVectors(origin, endpoint, p);
          dummy.position.x += Math.cos(a) * radius;
          dummy.position.y += Math.sin(a) * radius * 0.7;
          dummy.rotation.set(i + age * 4, age * 3, i);
          dummy.scale.setScalar(
            (0.12 + p * 0.22) *
              Math.min(1, age * 12) *
              Math.min(1, (0.65 - age) * 8),
          );
          dummy.updateMatrix();
          breath.setMatrixAt(i, dummy.matrix);
        }
        breath.instanceMatrix.needsUpdate = true;
      }
      glow.position.copy(head);
      glow.position.y -= 0.22;
      const charge =
        attack?.telegraph && attack.kind === "breath"
          ? Math.max(0, 1 - attack.remaining / attack.windup)
          : 0;
      glow.material.opacity = charge * 0.85;
      glow.visible = charge > 0;
      glow.scale.setScalar(0.6 + charge * 1.8);
      // Reduced motion keeps feedback brief and stationary, without camera shake.
      if (reduced) {
        sparks.visible = false;
        slash.rotation.z = 0;
        claw.rotation.z = -0.5;
      }
    },
  };
}
