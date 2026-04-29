import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { assetUrl } from '../utils/assetUrl';

const DIRT_SRC = assetUrl('/sprites/dirt.png');
const POOP_SRC = assetUrl('/sprites/poop.png');
const COMPLETION_THRESHOLD = 0.9;
const PROGRESS_SAMPLE_EVERY = 8;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

export default function PeeperCleaningOverlay({
  size,
  dirtyState,
  spongeActive,
  disabled = false,
  onPoopTap,
  onComplete,
  onToggleSponge,
  onProgressChange,
}) {
  const canvasRef = useRef(null);
  const dirtImageRef = useRef(null);
  const sampleCounterRef = useRef(0);
  const dirtyMaskRef = useRef(null);
  const dirtyPixelTotalRef = useRef(0);
  const isScrubbingRef = useRef(false);
  const activePointerIdRef = useRef(null);
  const lastPointRef = useRef(null);
  const completionTriggeredRef = useRef(false);
  const [assetsReady, setAssetsReady] = useState(false);
  const [poopBroken, setPoopBroken] = useState(false);
  const [poopAnimatingOut, setPoopAnimatingOut] = useState(false);
  const [progress, setProgress] = useState(0);
  const [spongePoint, setSpongePoint] = useState(null);

  const showPoop = dirtyState === 'poop' || poopAnimatingOut;
  const showDirt = dirtyState === 'poop' || dirtyState === 'scrubbing';
  const allowScrub = showDirt && dirtyState === 'scrubbing' && spongeActive && !disabled;
  const canPortal = typeof document !== 'undefined';
  const brushRadius = Math.max(18, size * 0.075);
  const poopTransform = poopAnimatingOut
    ? 'translate(-50%, -50%) scale(0.15) rotate(540deg)'
    : 'translate(-50%, -50%) scale(1) rotate(0deg)';

  const drawFallbackDirt = useCallback((ctx, width, height) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(110, 84, 36, 0.34)';
    const splats = [
      [width * 0.34, height * 0.34, width * 0.085],
      [width * 0.62, height * 0.3, width * 0.075],
      [width * 0.49, height * 0.48, width * 0.095],
      [width * 0.35, height * 0.59, width * 0.07],
      [width * 0.64, height * 0.61, width * 0.08],
      [width * 0.48, height * 0.67, width * 0.06],
    ];
    for (const [x, y, radius] of splats) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(74, 55, 24, 0.26)';
    const smudges = [
      [width * 0.43, height * 0.4, width * 0.12, height * 0.05, -0.38],
      [width * 0.57, height * 0.54, width * 0.13, height * 0.055, 0.34],
      [width * 0.47, height * 0.62, width * 0.11, height * 0.045, -0.18],
    ];
    for (const [x, y, rx, ry, rotation] of smudges) {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
      ctx.fill();
    }
  }, []);

  const redrawDirt = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !showDirt) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.globalCompositeOperation = 'source-over';
    if (dirtImageRef.current) {
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(dirtImageRef.current, 0, 0, size, size);
    } else {
      drawFallbackDirt(ctx, size, size);
    }

    sampleCounterRef.current = 0;
    completionTriggeredRef.current = false;
    lastPointRef.current = null;

    const baseline = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const dirtyMask = new Uint8Array(canvas.width * canvas.height);
    let dirtyPixelTotal = 0;

    for (let pixel = 0, alphaIndex = 3; alphaIndex < baseline.length; pixel += 1, alphaIndex += 4) {
      if (baseline[alphaIndex] > 20) {
        dirtyMask[pixel] = 1;
        dirtyPixelTotal += 1;
      }
    }

    dirtyMaskRef.current = dirtyMask;
    dirtyPixelTotalRef.current = dirtyPixelTotal;
    setProgress(0);
    onProgressChange?.(0);
  }, [drawFallbackDirt, onProgressChange, showDirt, size]);

  const measureProgress = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = image.data;
    const dirtyMask = dirtyMaskRef.current;
    const dirtyPixelTotal = dirtyPixelTotalRef.current;

    if (!dirtyMask || !dirtyPixelTotal) return 1;

    let transparent = 0;
    for (let pixel = 0, alphaIndex = 3; alphaIndex < pixels.length; pixel += 1, alphaIndex += 4) {
      if (dirtyMask[pixel] && pixels[alphaIndex] <= 20) {
        transparent += 1;
      }
    }

    return transparent / dirtyPixelTotal;
  }, []);

  const finishCleaning = useCallback(async () => {
    if (completionTriggeredRef.current) return;
    completionTriggeredRef.current = true;

    try {
      await onComplete?.();
    } catch (error) {
      completionTriggeredRef.current = false;
      redrawDirt();
      setSpongePoint(null);
      throw error;
    }
  }, [onComplete, redrawDirt]);

  const maybeFinishFromProgress = useCallback(() => {
    const nextProgress = measureProgress();
    setProgress(nextProgress);
    onProgressChange?.(nextProgress);
    if (nextProgress >= COMPLETION_THRESHOLD) {
      finishCleaning().catch(() => null);
    }
  }, [finishCleaning, measureProgress, onProgressChange]);

  const eraseAt = useCallback((x, y) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, brushRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, [brushRadius]);

  const eraseStroke = useCallback((point) => {
    if (!point) return;

    const previous = lastPointRef.current;
    if (!previous) {
      eraseAt(point.x, point.y);
      lastPointRef.current = point;
      sampleCounterRef.current += 1;
      return;
    }

    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(6, brushRadius * 0.45)));

    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      eraseAt(
        previous.x + (point.x - previous.x) * t,
        previous.y + (point.y - previous.y) * t
      );
    }

    lastPointRef.current = point;
    sampleCounterRef.current += 1;
    if (sampleCounterRef.current % PROGRESS_SAMPLE_EVERY === 0) {
      maybeFinishFromProgress();
    }
  }, [brushRadius, eraseAt, maybeFinishFromProgress]);

  const pointFromEvent = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadImage(DIRT_SRC)
      .then((image) => {
        if (cancelled) return;
        dirtImageRef.current = image;
        setAssetsReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        dirtImageRef.current = null;
        setAssetsReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showDirt || !assetsReady) return;
    redrawDirt();
  }, [assetsReady, redrawDirt, showDirt]);

  useEffect(() => {
    if (dirtyState === 'clean') {
      setProgress(0);
      onProgressChange?.(0);
      setSpongePoint(null);
      isScrubbingRef.current = false;
      activePointerIdRef.current = null;
      lastPointRef.current = null;
      completionTriggeredRef.current = false;
      setPoopAnimatingOut(false);
      return;
    }

    if (dirtyState === 'poop') {
      setPoopAnimatingOut(false);
      onProgressChange?.(0);
      setSpongePoint(null);
      isScrubbingRef.current = false;
      activePointerIdRef.current = null;
      lastPointRef.current = null;
    }
  }, [dirtyState]);

  useEffect(() => {
    if (!allowScrub) {
      isScrubbingRef.current = false;
      activePointerIdRef.current = null;
      lastPointRef.current = null;
      setSpongePoint(null);
    }
  }, [allowScrub]);

  useEffect(() => {
    if (dirtyState !== 'scrubbing' || !spongeActive) {
      setSpongePoint(null);
      return;
    }

    const updatePoint = (event) => {
      setSpongePoint({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener('pointermove', updatePoint);
    window.addEventListener('pointerdown', updatePoint);

    return () => {
      window.removeEventListener('pointermove', updatePoint);
      window.removeEventListener('pointerdown', updatePoint);
    };
  }, [dirtyState, spongeActive]);

  const handlePointerDown = useCallback((event) => {
    if (!allowScrub) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const point = pointFromEvent(event);
    if (!point) return;

    event.preventDefault();
    activePointerIdRef.current = event.pointerId;
    isScrubbingRef.current = true;
    lastPointRef.current = point;
    setSpongePoint({ x: event.clientX, y: event.clientY });
    canvasRef.current?.setPointerCapture?.(event.pointerId);
    eraseStroke(point);
  }, [allowScrub, eraseStroke, pointFromEvent]);

  const handlePointerMove = useCallback((event) => {
    const point = pointFromEvent(event);
    if (!point) return;

    if (allowScrub) {
      setSpongePoint({ x: event.clientX, y: event.clientY });
    }

    if (!allowScrub || !isScrubbingRef.current) return;
    if (activePointerIdRef.current !== event.pointerId) return;

    event.preventDefault();
    eraseStroke(point);
  }, [allowScrub, eraseStroke, pointFromEvent]);

  const finishPointerStroke = useCallback((pointerId) => {
    if (pointerId != null && activePointerIdRef.current !== pointerId) return;
    isScrubbingRef.current = false;
    activePointerIdRef.current = null;
    lastPointRef.current = null;
    setSpongePoint(null);
    maybeFinishFromProgress();
  }, [maybeFinishFromProgress]);

  const handlePointerUp = useCallback((event) => {
    canvasRef.current?.releasePointerCapture?.(event.pointerId);
    finishPointerStroke(event.pointerId);
  }, [finishPointerStroke]);

  const handlePointerCancel = useCallback((event) => {
    canvasRef.current?.releasePointerCapture?.(event.pointerId);
    finishPointerStroke(event.pointerId);
  }, [finishPointerStroke]);

  const handlePoopHit = useCallback(async () => {
    if (disabled || poopAnimatingOut) return;
    setPoopAnimatingOut(true);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      await onPoopTap?.();
      setPoopAnimatingOut(false);
    } catch (error) {
      setPoopAnimatingOut(false);
      throw error;
    }
  }, [disabled, onPoopTap, poopAnimatingOut]);

  if (!showDirt && !showPoop) return null;

  const floatingSpongeCursor = dirtyState === 'scrubbing' && spongeActive && spongePoint && canPortal
    ? createPortal(
        <div
          style={{
            position: 'fixed',
            left: spongePoint.x,
            top: spongePoint.y,
            zIndex: 340,
            transform: 'translate(-38%, -38%)',
            fontSize: Math.max(28, size * 0.14),
            pointerEvents: 'none',
            filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.22))',
          }}
        >
          {String.fromCodePoint(0x1F9FD)}
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
        }}
      >
        {showDirt && (
          <canvas
            ref={canvasRef}
            width={Math.max(1, Math.round(size))}
            height={Math.max(1, Math.round(size))}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: dirtyState === 'poop' ? 0.98 : 0.92,
              pointerEvents: allowScrub ? 'auto' : 'none',
              touchAction: 'none',
            }}
          />
        )}

        {showPoop && (
          <>
            {!poopBroken ? (
              <img
                src={POOP_SRC}
                alt=""
                onError={() => setPoopBroken(true)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  pointerEvents: 'none',
                  opacity: poopAnimatingOut ? 0 : 1,
                  transform: poopAnimatingOut ? 'scale(0.15) rotate(540deg)' : 'scale(1) rotate(0deg)',
                  transition: 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease',
                }}
              />
            ) : (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '70%',
                  transform: poopTransform,
                  transformOrigin: '50% 60%',
                  fontSize: Math.max(36, size * 0.18),
                  filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.18))',
                  opacity: poopAnimatingOut ? 0 : 1,
                  transition: 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease',
                  pointerEvents: 'none',
                }}
              >
                {String.fromCodePoint(0x1F4A9)}
              </div>
            )}

            <button
              type="button"
              onClick={handlePoopHit}
              disabled={disabled}
              aria-label="Clean poop"
              style={{
                position: 'absolute',
                left: '50%',
                top: '70%',
                width: `${size * 0.32}px`,
                height: `${size * 0.28}px`,
                transform: 'translate(-50%, -50%)',
                background: 'transparent',
                border: 'none',
                cursor: disabled ? 'default' : 'pointer',
                pointerEvents: 'auto',
              }}
            />

          </>
        )}
      </div>
      {floatingSpongeCursor}
    </>
  );
}
