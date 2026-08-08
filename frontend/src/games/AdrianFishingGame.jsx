import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import hailMaryUrl from '../assets/adrian/hail_mary.glb?url';
import adrianPlanetUrl from '../assets/adrian/adrian_planet.glb?url';
import spaceSkydomeUrl from '../assets/adrian/space_nebula_skydome.glb?url';
const rockyUrl = '/sprites/adrian/rocky.png';
import {
  ADRIAN_DURATION_SECONDS,
  ADRIAN_MAX_TAUMOEBA,
  createAdrianRun,
  getAdrianFlightErrorCue,
  getAdrianReward,
  getAdrianRockyMessage,
  getAdrianTarget,
  isAdrianAligned,
  stepAdrianRun,
} from './adrianSimulation.mjs';
import './AdrianFishingGame.css';

const DEFAULT_CONTROL = { angle: 0, thrust: 0 };

function cloneNormalizedScene(scene, targetSize, configureMaterial) {
  const object = scene.clone(true);
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.frustumCulled = true;
    child.castShadow = false;
    child.receiveShadow = false;
    child.material = child.material.clone();
    configureMaterial?.(child.material);
  });

  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const scale = targetSize / Math.max(size.x, size.y, size.z, 0.001);
  object.position.sub(center);
  const container = new THREE.Group();
  container.add(object);
  container.scale.setScalar(scale);
  container.updateMatrixWorld(true);
  return container;
}

function SceneModel({ url, size, material, ...groupProps }) {
  const gltf = useLoader(GLTFLoader, url);
  const object = useMemo(
    () => cloneNormalizedScene(gltf.scene, size, material),
    [gltf.scene, material, size],
  );

  return <primitive object={object} {...groupProps} />;
}

function AssetReady({ onReady }) {
  useLoader(GLTFLoader, [hailMaryUrl, adrianPlanetUrl, spaceSkydomeUrl]);
  useEffect(() => onReady?.(), [onReady]);
  return null;
}

function SpaceBackdrop() {
  const backdropRef = useRef(null);
  const configure = useCallback((material) => {
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.toneMapped = false;
  }, []);

  useFrame((_, delta) => {
    if (backdropRef.current) backdropRef.current.rotation.y += delta * 0.022;
  });

  return (
    <group ref={backdropRef} rotation={[0, -0.65, 0]}>
      <SceneModel
        url={spaceSkydomeUrl}
        size={70}
        material={configure}
        renderOrder={-20}
      />
    </group>
  );
}

function Adrian({ runRef }) {
  const planetRef = useRef(null);
  const atmosphereRef = useRef(null);
  const configure = useCallback((material) => {
    material.roughness = Math.min(1, (material.roughness ?? 0.8) + 0.08);
    material.metalness = 0;
  }, []);

  useFrame((state, delta) => {
    if (planetRef.current) planetRef.current.rotation.y += delta * 0.025;
    if (atmosphereRef.current) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 0.8) * 0.012;
      atmosphereRef.current.scale.setScalar(pulse);
      atmosphereRef.current.material.opacity = 0.1 + (runRef.current?.heat || 0) * 0.08;
    }
  });

  return (
    <group position={[0, -6.25, -3.2]} rotation={[-0.08, 0, 0]}>
      <group ref={planetRef}>
        <SceneModel url={adrianPlanetUrl} size={10.8} material={configure} />
      </group>
      <mesh ref={atmosphereRef} renderOrder={3}>
        <sphereGeometry args={[5.54, 48, 32]} />
        <meshBasicMaterial
          color="#baff38"
          transparent
          opacity={0.12}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function HailMary({ controlRef, runRef }) {
  const groupRef = useRef(null);
  const configure = useCallback((material) => {
    material.roughness = Math.max(0.28, material.roughness ?? 0.5);
    material.metalness = Math.max(0.35, material.metalness ?? 0.2);
  }, []);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const control = controlRef.current;
    const target = getAdrianTarget(runRef.current?.elapsedSeconds || 0);
    const cue = getAdrianFlightErrorCue(control, target);
    const error = control.angle - target.angle;
    group.rotation.z = THREE.MathUtils.damp(group.rotation.z, cue.tilt, 5, delta);
    group.rotation.y = THREE.MathUtils.damp(group.rotation.y, -0.22 + error * 0.12, 4, delta);
    group.position.x = THREE.MathUtils.damp(group.position.x, cue.x, 4, delta);
    group.position.y = THREE.MathUtils.damp(
      group.position.y,
      cue.y + Math.sin(state.clock.elapsedTime * 1.2) * 0.025,
      4,
      delta,
    );
  });

  return (
    <group ref={groupRef} position={[0, 0.62, 0]} rotation={[0.06, -0.22, -0.18]}>
      <SceneModel url={hailMaryUrl} size={3.45} material={configure} rotation={[0, 0, 0]} />
      <pointLight color="#c9edff" intensity={1.5} distance={5} position={[0, 0.4, 1.2]} />
      <pointLight color="#ff9c45" intensity={1.2} distance={3.5} position={[0, -1.35, 0]} />
    </group>
  );
}

function FlightMarker({ controlRef, runRef }) {
  const markerRef = useRef(null);

  useFrame((state, delta) => {
    const marker = markerRef.current;
    if (!marker) return;
    const target = getAdrianTarget(runRef.current?.elapsedSeconds || 0);
    const cue = getAdrianFlightErrorCue(controlRef.current, target);
    marker.position.x = THREE.MathUtils.damp(marker.position.x, cue.x, 4, delta);
    marker.position.y = THREE.MathUtils.damp(
      marker.position.y,
      cue.y + Math.sin(state.clock.elapsedTime * 1.2) * 0.025,
      4,
      delta,
    );
  });

  return (
    <group ref={markerRef} position={[0, 0.62, 0.72]} rotation={[0, 0, -0.18]} renderOrder={14}>
      <mesh>
        <ringGeometry args={[0.14, 0.19, 4]} />
        <meshBasicMaterial color="#d9fbff" transparent opacity={0.96} depthTest={false} depthWrite={false} />
      </mesh>
      <mesh>
        <circleGeometry args={[0.045, 12]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.98} depthTest={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

function SafeZoneDirector({ controlRef, runRef }) {
  const directorRef = useRef(null);
  const materialRefs = useRef([]);

  useFrame((state, delta) => {
    const director = directorRef.current;
    if (!director) return;

    const target = getAdrianTarget(runRef.current?.elapsedSeconds || 0);
    const control = controlRef.current;
    const aligned = isAdrianAligned(control, target);
    const pulse = 0.84 + Math.sin(state.clock.elapsedTime * 4) * 0.1;

    director.rotation.z = THREE.MathUtils.damp(director.rotation.z, -0.18, 7, delta);
    director.scale.setScalar(aligned ? 1 + pulse * 0.035 : 1);

    for (const material of materialRefs.current) {
      if (!material) continue;
      material.color.set(aligned ? '#dfff4a' : '#9eeeff');
      material.opacity = aligned ? 0.88 : 0.56;
    }
  });

  const captureMaterial = (material) => {
    if (material && !materialRefs.current.includes(material)) materialRefs.current.push(material);
  };

  return (
    <group ref={directorRef} position={[0, 0.62, 0.58]} rotation={[0, 0, -0.18]} renderOrder={12}>
      <mesh>
        <ringGeometry args={[0.34, 0.4, 4]} />
        <meshBasicMaterial
          ref={captureMaterial}
          color="#9eeeff"
          transparent
          opacity={0.56}
          side={THREE.DoubleSide}
          depthTest={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh position={[-0.53, 0, 0]}>
        <boxGeometry args={[0.2, 0.035, 0.035]} />
        <meshBasicMaterial ref={captureMaterial} color="#9eeeff" transparent opacity={0.56} depthTest={false} />
      </mesh>
      <mesh position={[0.53, 0, 0]}>
        <boxGeometry args={[0.2, 0.035, 0.035]} />
        <meshBasicMaterial ref={captureMaterial} color="#9eeeff" transparent opacity={0.56} depthTest={false} />
      </mesh>
    </group>
  );
}

function CollectorChain({ controlRef, runRef }) {
  const lineRef = useRef(null);
  const linksRef = useRef(null);
  const collectorRef = useRef(null);
  const glowRef = useRef(null);
  const pointCount = 28;
  const chainMath = useMemo(() => ({
    start: new THREE.Vector3(),
    end: new THREE.Vector3(),
    point: new THREE.Vector3(),
    nextPoint: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    matrix: new THREE.Matrix4(),
    quaternion: new THREE.Quaternion(),
    up: new THREE.Vector3(0, 1, 0),
    scale: new THREE.Vector3(1, 1, 1),
  }), []);
  const geometry = useMemo(() => {
    const positions = new Float32Array(pointCount * 3);
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return buffer;
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state) => {
    const positions = geometry.attributes.position.array;
    const control = controlRef.current;
    const run = runRef.current || createAdrianRun();
    const target = getAdrianTarget(run.elapsedSeconds);
    const shipCue = getAdrianFlightErrorCue(control, target);
    const error = control.angle - target.angle;
    const strain = run.chainStrain || 0;
    const start = chainMath.start.set(shipCue.x * 0.74, -0.52 + shipCue.y - 0.62, -0.08);
    const end = chainMath.end.set(-0.18 + error * 0.55, -2.18, 0.62);
    const sway = Math.sin(state.clock.elapsedTime * (2.2 + strain * 5)) * (0.035 + strain * 0.15);

    for (let index = 0; index < pointCount; index += 1) {
      const t = index / (pointCount - 1);
      const x = THREE.MathUtils.lerp(start.x, end.x, t) + Math.sin(t * Math.PI) * (error * 0.42 + sway);
      const y = THREE.MathUtils.lerp(start.y, end.y, t) - Math.sin(t * Math.PI) * 0.22;
      const z = THREE.MathUtils.lerp(start.z, end.z, t) - Math.sin(t * Math.PI) * 0.1;
      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;
    }
    geometry.attributes.position.needsUpdate = true;

    if (linksRef.current) {
      const { point, nextPoint, direction, matrix, quaternion, up, scale } = chainMath;
      for (let index = 0; index < 20; index += 1) {
        const positionIndex = Math.round(index / 19 * (pointCount - 2));
        point.fromArray(positions, positionIndex * 3);
        nextPoint.fromArray(positions, (positionIndex + 1) * 3);
        direction.copy(nextPoint).sub(point).normalize();
        quaternion.setFromUnitVectors(up, direction);
        matrix.compose(point, quaternion, scale);
        linksRef.current.setMatrixAt(index, matrix);
      }
      linksRef.current.instanceMatrix.needsUpdate = true;
    }

    if (collectorRef.current) {
      collectorRef.current.position.copy(end);
      collectorRef.current.rotation.z = error * 0.35;
    }
    if (glowRef.current) {
      glowRef.current.material.opacity = 0.18 + run.stability * 0.55;
      glowRef.current.scale.setScalar(0.85 + run.stability * 0.25);
    }
  });

  return (
    <>
      <line ref={lineRef} geometry={geometry} renderOrder={4} frustumCulled={false}>
        <lineBasicMaterial color="#d8c987" transparent opacity={0.92} depthWrite={false} />
      </line>
      <instancedMesh ref={linksRef} args={[null, null, 20]} renderOrder={5} frustumCulled={false}>
        <cylinderGeometry args={[0.018, 0.018, 0.095, 6]} />
        <meshBasicMaterial color="#f0dc8d" depthWrite={false} />
      </instancedMesh>
      <group ref={collectorRef} position={[0, -2.18, 0.62]}>
        <mesh ref={glowRef} rotation={[-0.08, 0, 0]}>
          <circleGeometry args={[0.19, 24]} />
          <meshBasicMaterial
            color="#d9ff41"
            transparent
            opacity={0.48}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[0, 0, -0.006]} rotation={[-0.08, 0, 0]}>
          <ringGeometry args={[0.145, 0.19, 24]} />
          <meshBasicMaterial
            color="#efffc7"
            transparent
            opacity={0.74}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </>
  );
}

function AdrianScene({ controlRef, runRef, showFlightDirector, onAssetsReady }) {
  return (
    <Canvas
      className="adrian-fishing-canvas"
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.35, 9.4], fov: 49, near: 0.05, far: 100 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      <color attach="background" args={['#02050a']} />
      <ambientLight intensity={1.05} color="#c7d8d2" />
      <directionalLight intensity={2.2} color="#d8f0ff" position={[-3, 5, 5]} />
      <pointLight intensity={3.2} color="#baff39" position={[3, -3, 2]} distance={10} />
      <Suspense fallback={null}>
        <AssetReady onReady={onAssetsReady} />
        <SpaceBackdrop />
        <Adrian runRef={runRef} />
        {showFlightDirector && <SafeZoneDirector controlRef={controlRef} runRef={runRef} />}
        <HailMary controlRef={controlRef} runRef={runRef} />
        {showFlightDirector && <FlightMarker controlRef={controlRef} runRef={runRef} />}
        <CollectorChain controlRef={controlRef} runRef={runRef} />
      </Suspense>
    </Canvas>
  );
}

function FlightStick({ controlRef, disabled }) {
  const padRef = useRef(null);
  const [position, setPosition] = useState(DEFAULT_CONTROL);

  const update = useCallback((clientX, clientY) => {
    const bounds = padRef.current?.getBoundingClientRect();
    if (!bounds || disabled) return;
    const radius = bounds.width / 2;
    let x = (clientX - (bounds.left + radius)) / radius;
    let y = (clientY - (bounds.top + radius)) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    const next = { angle: x, thrust: -y };
    controlRef.current = next;
    setPosition(next);
  }, [controlRef, disabled]);

  const handlePointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    update(event.clientX, event.clientY);
  };

  return (
    <div
      ref={padRef}
      className={`adrian-flight-stick${disabled ? ' is-disabled' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) update(event.clientX, event.clientY);
      }}
    >
      <span className="adrian-stick-label adrian-stick-label-top">THRUST</span>
      <span className="adrian-stick-label adrian-stick-label-left">ANGLE</span>
      <span className="adrian-stick-label adrian-stick-label-right">ANGLE</span>
      <div className="adrian-stick-cross" />
      <div
        className="adrian-stick-thumb"
        style={{ transform: `translate(calc(-50% + ${position.angle * 39}px), calc(-50% + ${-position.thrust * 39}px))` }}
      />
    </div>
  );
}

function Meter({ label, value, danger }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="adrian-meter">
      <div className="adrian-meter-label"><span>{label}</span><b>{percent}%</b></div>
      <div className="adrian-meter-track">
        <div className={`adrian-meter-fill${danger ? ' is-danger' : ''}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default function AdrianFishingGame({ onComplete, onClose }) {
  const controlRef = useRef({ ...DEFAULT_CONTROL });
  const runRef = useRef(createAdrianRun());
  const frameRef = useRef(0);
  const lastTimeRef = useRef(0);
  const lastHudAtRef = useRef(0);
  const [phase, setPhase] = useState('loading');
  const [hud, setHud] = useState(runRef.current);
  const [calibrationCount, setCalibrationCount] = useState(3);
  const [rockyLine, setRockyLine] = useState('Small marker inside big diamond. Then hold!');

  const stopLoop = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
  }, []);

  const runFrame = useCallback((now) => {
    const deltaSeconds = Math.min(0.1, Math.max(0, (now - lastTimeRef.current) / 1000));
    lastTimeRef.current = now;
    runRef.current = stepAdrianRun(runRef.current, controlRef.current, deltaSeconds);

    if (now - lastHudAtRef.current > 90 || runRef.current.finished) {
      lastHudAtRef.current = now;
      setHud({ ...runRef.current });
    }

    if (runRef.current.finished) {
      setPhase('result');
      return;
    }
    frameRef.current = requestAnimationFrame(runFrame);
  }, []);

  const beginCollection = useCallback(() => {
    setPhase('playing');
    lastTimeRef.current = performance.now();
    lastHudAtRef.current = 0;
    frameRef.current = requestAnimationFrame(runFrame);
  }, [runFrame]);

  const startGame = useCallback(() => {
    stopLoop();
    controlRef.current = { ...DEFAULT_CONTROL };
    runRef.current = createAdrianRun();
    setHud({ ...runRef.current });
    setCalibrationCount(3);
    setRockyLine('Small marker inside big diamond. Then hold!');
    setPhase('calibration');
  }, [stopLoop]);

  const handleAssetsReady = useCallback(() => {
    setPhase((current) => current === 'loading' ? 'intro' : current);
  }, []);

  useEffect(() => {
    if (phase !== 'calibration') return undefined;

    const endsAt = performance.now() + 3000;
    const timer = window.setInterval(() => {
      const remainingMs = Math.max(0, endsAt - performance.now());
      setCalibrationCount(Math.max(1, Math.ceil(remainingMs / 1000)));
      if (remainingMs <= 0) {
        window.clearInterval(timer);
        beginCollection();
      }
    }, 50);

    return () => window.clearInterval(timer);
  }, [beginCollection, phase]);

  const rockySecond = Math.floor(hud.elapsedSeconds);
  useEffect(() => {
    if (phase === 'calibration') {
      setRockyLine('Small marker inside big diamond. Then hold!');
      return;
    }
    if (phase !== 'playing') return;

    setRockyLine(getAdrianRockyMessage({
      run: hud,
      control: controlRef.current,
      target: getAdrianTarget(hud.elapsedSeconds),
      variant: rockySecond,
    }));
  }, [phase, rockySecond]);

  useEffect(() => stopLoop, [stopLoop]);

  const reward = getAdrianReward(hud.taumoebaCollected);
  const secondsLeft = Math.max(0, ADRIAN_DURATION_SECONDS - hud.elapsedSeconds);
  const collectionPercent = Math.min(100, hud.taumoebaCollected / ADRIAN_MAX_TAUMOEBA * 100);
  const collectedMillions = hud.taumoebaCollected / 1_000_000;
  const flightActive = phase === 'calibration' || phase === 'playing';

  return (
    <div className="adrian-fishing-game">
      <AdrianScene
        controlRef={controlRef}
        runRef={runRef}
        showFlightDirector={flightActive}
        onAssetsReady={handleAssetsReady}
      />

      <header className="adrian-game-header">
        <button type="button" className="app-back-button adrian-back" onClick={onClose}>Back</button>
        <div>
          <span>ADRIAN FISHING</span>
          <b>{phase === 'playing'
            ? `${secondsLeft.toFixed(1)}s`
            : phase === 'calibration'
              ? `CALIBRATE · ${calibrationCount}`
              : phase === 'loading'
                ? 'LOADING MISSION'
                : 'TAUMOEBA DIVE'}</b>
        </div>
        <div className="adrian-reward-chip">{reward}/10 ✦</div>
      </header>

      {flightActive && (
        <>
          <section className="adrian-hud">
            <div className="adrian-collection-row">
              <span>TAUMOEBA</span>
              <b>{phase === 'calibration' ? 'ALIGN SHIP' : `${collectedMillions.toFixed(1)}M / 10M`}</b>
            </div>
            <div className="adrian-collection-track">
              <div style={{ width: `${collectionPercent}%` }} />
            </div>
            <div className="adrian-meter-grid">
              <Meter label="CHAIN" value={hud.chainStrain} danger={hud.chainStrain > 0.65} />
              <Meter label="HEAT" value={hud.heat} danger={hud.heat > 0.65} />
            </div>
          </section>

          <aside className="adrian-rocky-call">
            <img src={rockyUrl} alt="Rocky" />
            <div><b>ROCKY</b><span>{rockyLine}</span></div>
          </aside>

          <FlightStick
            controlRef={controlRef}
            disabled={false}
          />
        </>
      )}

      {phase === 'loading' && (
        <div className="adrian-loading-overlay" role="status" aria-live="polite">
          <div className="adrian-loading-spinner" />
          <b>Preparing Adrian dive</b>
          <span>Loading ship, planet and atmosphere...</span>
        </div>
      )}

      {phase === 'calibration' && (
        <div className="adrian-calibration-countdown" aria-live="polite">
          <b>{calibrationCount}</b>
          <span>KEEP THE SMALL MARKER INSIDE THE DIAMOND</span>
        </div>
      )}

      {phase === 'intro' && (
        <div className="adrian-overlay">
          <div className="adrian-overlay-card">
            <span className="adrian-kicker">PROJECT HAIL MARY</span>
            <h2>Fish Adrian's atmosphere</h2>
            <p>Use the joystick to keep the ship's small marker inside the large diamond.</p>
            <div className="adrian-mission-grid">
              <div><b>10s</b><span>DIVE</span></div>
              <div><b>10M</b><span>TAUMOEBA</span></div>
              <div><b>10 ✦</b><span>MAX REWARD</span></div>
            </div>
            <p className="adrian-control-copy">You get 3 seconds to align before the 10-second collection begins.</p>
            <button type="button" className="adrian-primary-btn" onClick={startGame}>Start dive</button>
          </div>
        </div>
      )}

      {phase === 'result' && (
        <div className="adrian-overlay">
          <div className="adrian-overlay-card adrian-result-card">
            <span className="adrian-kicker">SAMPLE SECURED</span>
            <h2>{hud.failed ? 'Emergency retrieval' : 'Collector recovered'}</h2>
            <div className="adrian-result-number">{collectedMillions.toFixed(1)}M</div>
            <p>Taumoeba collected</p>
            <div className="adrian-result-reward">+{reward} ✦</div>
            <button
              type="button"
              className="adrian-primary-btn"
              onClick={() => onComplete(reward, reward > 0)}
            >
              Collect reward
            </button>
            <button type="button" className="adrian-secondary-btn" onClick={startGame}>Try again</button>
          </div>
        </div>
      )}
    </div>
  );
}
