import React from 'react';
import { FlaskConical, Heart, ShoppingBag, Store, Utensils, X } from 'lucide-react';
import {
  MARKET_ITEMS,
  type LivePlayerState,
  type LiveWorldState,
  type MarketItemId,
  type PlayerProgress,
} from '../shared/gameCatalog';

interface MarketModalProps {
  open: boolean;
  onClose: () => void;
  worldState: LiveWorldState;
  localPlayer?: LivePlayerState;
  localProgress: PlayerProgress;
  onBuy: (itemId: MarketItemId, useNow: boolean) => void;
  onUsePotion: () => void;
  onUseFood: () => void;
}

export const MarketModal: React.FC<MarketModalProps> = ({
  open,
  onClose,
  worldState,
  localPlayer,
  localProgress,
  onBuy,
  onUsePotion,
  onUseFood,
}) => {
  if (!open) return null;

  const hp = Math.round(localPlayer?.hp ?? 100);
  const maxHp = localPlayer?.maxHp ?? 100;
  const hunger = Math.round(localPlayer?.hunger ?? 100);
  const maxHunger = localPlayer?.maxHunger ?? 100;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-950/80 px-6 py-4">
          <div>
            <h2 className="font-display text-xl font-extrabold text-white flex items-center gap-2">
              <Store className="h-5 w-5 text-rose-400" />
              Mini Mercato dell’Isola
            </h2>
            <p className="mt-0.5 text-xs text-slate-400 tabular-nums">
              Cubi disponibili: <strong className="text-amber-400">{worldState.bankCubes} ■</strong> ·
              Vita <strong className="text-rose-300">{hp}/{maxHp}</strong> ·
              Fame <strong className="text-amber-300">{hunger}/{maxHunger}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-6 space-y-4">
          <div className="rounded-xl border border-amber-400/25 bg-slate-950/70 px-4 py-3 text-xs text-slate-300">
            Scambia i tuoi <strong className="text-amber-300">Cubi</strong> con scorte di sopravvivenza.
            Se la <strong className="text-amber-300">Fame</strong> scende a 0 inizi a perdere Vita; se la{' '}
            <strong className="text-rose-300">Vita</strong> arriva a 0 muori e perdi tutti i tuoi cubi!
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {MARKET_ITEMS.map((item) => {
              const isPotion = item.id === 'potion';
              const owned = isPotion ? localProgress.potions || 0 : localProgress.food || 0;
              const canAfford = worldState.bankCubes >= item.cost;
              const needsStat = isPotion ? hp < maxHp : hunger < maxHunger - 1;

              return (
                <div
                  key={item.id}
                  className="flex flex-col justify-between rounded-xl border border-white/15 bg-slate-800/85 p-4"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div
                          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                            isPotion ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'
                          }`}
                        >
                          {isPotion ? <FlaskConical className="h-5 w-5" /> : <Utensils className="h-5 w-5" />}
                        </div>
                        <div>
                          <h3 className="font-display text-sm font-bold text-white">{item.name}</h3>
                          <span className="text-[11px] font-bold text-amber-400 tabular-nums">
                            Costo: {item.cost} ■
                          </span>
                        </div>
                      </div>
                      <span className="rounded-md bg-slate-950 px-2 py-0.5 text-[11px] font-bold text-cyan-300 tabular-nums">
                        Nello zaino: {owned}
                      </span>
                    </div>

                    <p className="mt-2.5 text-xs leading-relaxed text-slate-300">{item.description}</p>
                    <p
                      className={`mt-2 rounded-lg bg-slate-950/75 px-2.5 py-1.5 text-[11px] font-medium ${
                        isPotion ? 'text-rose-300' : 'text-amber-300'
                      }`}
                    >
                      {item.effectSummary}
                    </p>
                  </div>

                  <div className="mt-4 flex flex-col gap-2 pt-3 border-t border-white/10">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!canAfford}
                        onClick={() => onBuy(item.id, false)}
                        className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold tabular-nums cursor-pointer ${
                          canAfford
                            ? 'bg-slate-700 text-white hover:bg-slate-600'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        <ShoppingBag className="h-3.5 w-3.5" />
                        Compra ({item.cost} ■)
                      </button>

                      <button
                        type="button"
                        disabled={!canAfford || !needsStat}
                        onClick={() => onBuy(item.id, true)}
                        className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold tabular-nums cursor-pointer ${
                          canAfford && needsStat
                            ? isPotion
                              ? 'bg-rose-500 text-white hover:bg-rose-400'
                              : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        {isPotion ? <Heart className="h-3.5 w-3.5" /> : <Utensils className="h-3.5 w-3.5" />}
                        Compra &amp; Usa
                      </button>
                    </div>

                    {owned > 0 && needsStat && (
                      <button
                        type="button"
                        onClick={isPotion ? onUsePotion : onUseFood}
                        className="w-full rounded-lg border border-white/10 bg-slate-950/80 py-1.5 text-[11px] font-bold text-emerald-300 hover:bg-slate-950 cursor-pointer"
                      >
                        {isPotion
                          ? `Usa Pozione dallo zaino (${owned})`
                          : `Mangia Cibo dallo zaino (${owned})`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
