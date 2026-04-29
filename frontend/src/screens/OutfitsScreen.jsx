import React, { useState } from 'react';
import ShopScreen     from './ShopScreen';
import WardrobeScreen from './WardrobeScreen';

export default function OutfitsScreen() {
  const [tab, setTab] = useState('wardrobe');

  return (
    <div>
      <div className="inner-tabs" style={{ marginTop: 16 }}>
        <button className={`inner-tab${tab === 'wardrobe' ? ' active' : ''}`}
          onClick={() => setTab('wardrobe')}>
          👗 Wardrobe
        </button>
        <button className={`inner-tab${tab === 'shop' ? ' active' : ''}`}
          onClick={() => setTab('shop')}>
          🛒 Shop
        </button>
      </div>
      {tab === 'wardrobe' ? <WardrobeScreen /> : <ShopScreen />}
    </div>
  );
}
