import React from 'react';
import PeeperSprite from './PeeperSprite';
import HomeLayerImage from './HomeLayerImage';
import { assetUrl } from '../utils/assetUrl';
import {
  HOME_BUILTIN_FLOOR_PATH,
  HOME_BUILTIN_WALL_PATH,
  HOME_CANVAS_HEIGHT,
  HOME_CANVAS_WIDTH,
  VISIT_HOME_OWNER_CENTER_X,
  VISIT_HOME_PEEPER_CENTER_Y,
  VISIT_HOME_PEEPER_SIZE,
  VISIT_HOME_VIEWER_CENTER_X,
} from '../homeConstants';

export default function VisitHomeScene({ home, viewerPeeper, ownerPeeper }) {
  const slots = home?.slots || {};
  const backDecor = Array.isArray(slots.back_decor)
    ? [...slots.back_decor].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    : [];

  return (
    <div
      className="personal-home-canvas personal-home-canvas-fullscreen"
      style={{
        '--home-canvas-width': HOME_CANVAS_WIDTH,
        '--home-canvas-height': HOME_CANVAS_HEIGHT,
      }}
    >
      <div className="personal-home-scene personal-home-scene-fullscreen visit-home-scene">
        <img src={assetUrl(HOME_BUILTIN_WALL_PATH)} alt="" className="home-layer-image" draggable={false} />
        <HomeLayerImage item={slots.wall_base} />
        <img src={assetUrl(HOME_BUILTIN_FLOOR_PATH)} alt="" className="home-layer-image" draggable={false} />
        <HomeLayerImage item={slots.floor_base} />
        <HomeLayerImage item={slots.floor_cover} />

        {backDecor.map((item) => (
          <HomeLayerImage key={`${item.item_id}-${item.sort_order}`} item={item} />
        ))}

        {viewerPeeper && (
          <div
            className="visit-home-peeper-wrap visit-home-peeper-left"
            style={{
              width: VISIT_HOME_PEEPER_SIZE,
              height: VISIT_HOME_PEEPER_SIZE,
              left: `${(VISIT_HOME_VIEWER_CENTER_X / HOME_CANVAS_WIDTH) * 100}%`,
              top: `${(VISIT_HOME_PEEPER_CENTER_Y / HOME_CANVAS_HEIGHT) * 100}%`,
            }}
          >
            <PeeperSprite peeper={viewerPeeper} size={VISIT_HOME_PEEPER_SIZE} />
          </div>
        )}

        {ownerPeeper && (
          <div
            className="visit-home-peeper-wrap visit-home-peeper-right"
            style={{
              width: VISIT_HOME_PEEPER_SIZE,
              height: VISIT_HOME_PEEPER_SIZE,
              left: `${(VISIT_HOME_OWNER_CENTER_X / HOME_CANVAS_WIDTH) * 100}%`,
              top: `${(VISIT_HOME_PEEPER_CENTER_Y / HOME_CANVAS_HEIGHT) * 100}%`,
            }}
          >
            <div className="visit-home-peeper-mirror">
              <PeeperSprite peeper={ownerPeeper} size={VISIT_HOME_PEEPER_SIZE} />
            </div>
          </div>
        )}

        <HomeLayerImage item={slots.foreground_item} />
      </div>
    </div>
  );
}
