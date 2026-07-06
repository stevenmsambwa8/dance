/* ══════════ FLOATING TRIGGER ══════════ */
.trigger {
  position: fixed;
  right: 16px;
  bottom: 90px;
  z-index: 210;
  width: 48px;
  height: 48px;
  border-radius: 0;
  border: none;
  background: linear-gradient(145deg, #6366f1, #a855f7);
  color: #fff;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(99,102,241,0.45);
}
.triggerPulse { animation: triggerPulse 1.8s ease-in-out infinite; }
.triggerDot {
  position: absolute;
  top: -3px; right: -3px;
  width: 12px; height: 12px;
  border-radius: 0;
  background: #ef4444;
  box-shadow: 0 0 0 2px #0b0b0f;
}
@keyframes triggerPulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.08); }
}

/* ══════════ OVERLAY / MODAL SHELL ══════════ */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: rgba(0,0,0,0.72);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: fadeIn 0.2s ease;
}
@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }

.modal {
  position: relative;
  width: 100%;
  max-width: 380px;
  border-radius: 0;
  overflow: hidden;
  padding: 26px 20px 20px;
  background:
    radial-gradient(circle at 15% 0%, rgba(168,85,247,0.35), transparent 55%),
    radial-gradient(circle at 100% 100%, rgba(99,102,241,0.35), transparent 55%),
    linear-gradient(160deg, #14121f 0%, #0b0b12 100%);
  animation: modalIn 0.28s cubic-bezier(0.22, 1, 0.36, 1);
  box-shadow: 0 30px 80px rgba(0,0,0,0.55);
}
@keyframes modalIn {
  from { opacity: 0; transform: translateY(16px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

/* Diagonal shine sweep across the whole card, purely decorative.
   Animates via `transform` on a two-segment track (classic seamless
   marquee) instead of animating `background-position` — the old approach
   forces a repaint every frame and looks choppy/janky on mobile GPUs.
   transform is compositor-only, so this stays buttery smooth. */
.glow {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.glowTrack {
  display: flex;
  width: 200%;
  height: 100%;
  animation: glowSlide 5s linear infinite;
  will-change: transform;
}
.glowSeg {
  flex: 0 0 50%;
  height: 100%;
  background: repeating-linear-gradient(
    115deg,
    transparent 0px,
    transparent 40px,
    rgba(255,255,255,0.07) 40px,
    rgba(255,255,255,0.07) 60px,
    transparent 60px,
    transparent 140px
  );
}
@keyframes glowSlide {
  from { transform: translate3d(0, 0, 0); }
  to   { transform: translate3d(-50%, 0, 0); }
}

.closeBtn {
  position: absolute;
  top: 12px; right: 12px;
  z-index: 2;
  width: 28px; height: 28px;
  border-radius: 0;
  border: none;
  background: rgba(255,255,255,0.08);
  color: #fff;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

/* ══════════ HEADER ══════════ */
.header {
  position: relative;
  z-index: 1;
  text-align: center;
  margin-bottom: 20px;
}
.giftIcon {
  width: 56px; height: 56px;
  margin: 0 auto 10px;
  border-radius: 0;
  background: linear-gradient(145deg, #6366f1, #a855f7);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  color: #fff;
  box-shadow: 0 10px 30px rgba(168,85,247,0.5);
  animation: giftFloat 2.4s ease-in-out infinite;
}
@keyframes giftFloat {
  0%, 100% { transform: translateY(0) rotate(-3deg); }
  50%      { transform: translateY(-5px) rotate(3deg); }
}
.title {
  font-size: 17px;
  font-weight: 900;
  color: #fff;
  margin: 0 0 4px;
  letter-spacing: 0.01em;
}
.subtitle {
  font-size: 12px;
  color: rgba(255,255,255,0.55);
  margin: 0;
}

/* ══════════ DAY PIPS — filled/glow states, no border colors ══════════ */
.days {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 18px;
}
.dayPip {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 14px 4px;
  border-radius: 0;
  background: rgba(255,255,255,0.05);
}
.dayNum { font-size: 10px; font-weight: 800; color: rgba(255,255,255,0.4); }
.dayPts { font-size: 12px; font-weight: 900; color: rgba(255,255,255,0.75); }

.dayDone {
  background: linear-gradient(160deg, rgba(34,197,94,0.35), rgba(34,197,94,0.12));
  box-shadow: inset 0 0 0 1px rgba(34,197,94,0.25);
}
.dayDone .dayNum, .dayDone .dayPts { color: #4ade80; }
.dayCheck {
  position: absolute;
  top: 2px; right: 2px;
  font-size: 9px;
  color: #4ade80;
}

.dayTarget {
  background: linear-gradient(160deg, rgba(168,85,247,0.4), rgba(99,102,241,0.2));
  box-shadow: 0 0 16px rgba(168,85,247,0.5);
  animation: targetPulse 1.6s ease-in-out infinite;
}
.dayTarget .dayNum, .dayTarget .dayPts { color: #fff; }
@keyframes targetPulse {
  0%, 100% { box-shadow: 0 0 10px rgba(168,85,247,0.4); }
  50%      { box-shadow: 0 0 22px rgba(168,85,247,0.7); }
}

.dayFinal { background: linear-gradient(160deg, rgba(245,158,11,0.25), rgba(255,255,255,0.05)); grid-column: span 2; }
.dayFinal.dayTarget { background: linear-gradient(160deg, #f59e0b, #a855f7); }
.dayFinal .dayPts { color: #fbbf24; }

/* ══════════ CLAIM BUTTON ══════════ */
.claimBtn {
  position: relative;
  z-index: 1;
  width: 100%;
  padding: 13px;
  border-radius: 0;
  border: none;
  background: linear-gradient(120deg, #6366f1, #a855f7);
  color: #fff;
  font-size: 13.5px;
  font-weight: 900;
  letter-spacing: 0.01em;
  cursor: pointer;
  box-shadow: 0 10px 26px rgba(99,102,241,0.4);
}
.claimBtn:disabled {
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.4);
  box-shadow: none;
  cursor: default;
}

.claimedMsg {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  flex-wrap: wrap;
  font-size: 12.5px;
  font-weight: 800;
  color: #4ade80;
  padding: 13px;
  background: rgba(34,197,94,0.1);
  border-radius: 0;
}
.brokenNote {
  width: 100%;
  text-align: center;
  font-size: 10.5px;
  font-weight: 600;
  color: rgba(255,255,255,0.45);
}

.footNote {
  position: relative;
  z-index: 1;
  font-size: 10px;
  color: rgba(255,255,255,0.4);
  text-align: center;
  margin: 10px 0 0;
}
