import React from 'react';
import PeeperSprite from './PeeperSprite';
import HomeLayerImage from './HomeLayerImage';
import { assetUrl } from '../utils/assetUrl';
import {
  HOME_BUILTIN_FLOOR_PATH,
  HOME_BUILTIN_WALL_PATH,
  HOME_CANVAS_HEIGHT,
  HOME_CANVAS_WIDTH,
  HOME_PEEPER_SIZE,
} from '../homeConstants';

export default function HomeScene({
  home,
  peeper,
  fullscreen = false,
  showPeeper = true,
  peeperSize = HOME_PEEPER_SIZE,
  peeperContent = null,
  shellClassName = null,
  sceneClassName = '',
  shellStyle = null,
  sceneStyle = null,
}) {
  const slots = home?.slots || {};
  const backDecor = Array.isArray(slots.back_decor) ? [...slots.back_decor].sort((a, b) => a.sort_order - b.sort_order) : [];
  const resolvedShellClassName = shellClassName || (fullscreen
    ? 'personal-home-canvas personal-home-canvas-fullscreen'
    : 'personal-home-canvas');
  const resolvedSceneClassName = [
    'personal-home-scene',
    fullscreen ? 'personal-home-scene-fullscreen' : '',
    sceneClassName,
  ].filter(Boolean).join(' ');

  return (
    <div
      className={resolvedShellClassName}
      style={{
        '--home-canvas-width': HOME_CANVAS_WIDTH,
        '--home-canvas-height': HOME_CANVAS_HEIGHT,
        ...shellStyle,
      }}
    >
      <div className={resolvedSceneClassName} style={sceneStyle}>
        <img src={assetUrl(HOME_BUILTIN_WALL_PATH)} alt="" className="home-layer-image" draggable={false} />
        <HomeLayerImage item={slots.wall_base} />
        <img src={assetUrl(HOME_BUILTIN_FLOOR_PATH)} alt="" className="home-layer-image" draggable={false} />
        <HomeLayerImage item={slots.floor_base} />
        <HomeLayerImage item={slots.floor_cover} />
        {backDecor.map((item) => (
          <HomeLayerImage key={`${item.item_id}-${item.sort_order}`} item={item} />
        ))}

        {showPeeper && (
          <div
            className="home-peeper-wrap"
            style={{
              width: peeperSize,
              height: peeperSize,
              pointerEvents: peeperContent ? 'auto' : undefined,
            }}
          >
            {peeperContent || <PeeperSprite peeper={peeper} size={peeperSize} />}
          </div>
        )}

        <HomeLayerImage item={slots.foreground_item} />
      </div>
    </div>
  );
}
