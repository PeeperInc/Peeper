import "./ScenePeeper.css";
import React, { createContext, forwardRef, useContext } from "react";
import PeeperSprite from "../components/PeeperSprite";
export const ScenePeeperContext = createContext(null);
const ScenePeeper = forwardRef(function ScenePeeper(
  { className = "", children },
  ref,
) {
  const peeper = useContext(ScenePeeperContext);
  return peeper ? (
    <div
      ref={ref}
      className={`scene-peeper ${className}`}
      aria-label="Your equipped Peeper"
    >
      <PeeperSprite peeper={peeper} size={150} showDead={false} />
      {children}
    </div>
  ) : null;
});
export default ScenePeeper;
