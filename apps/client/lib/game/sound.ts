import { type ClientGameState, ShipStatus, AlertStatus } from "@netrek/shared";
import { getMySlot } from "./state";

// ---------------------------------------------------------------------------
// Sound effects — original Netrek WAV files via Web Audio API
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;
const bufferCache = new Map<string, AudioBuffer>();

// Track previous frame state to detect new events
let prevTorpCount = 0;
let prevPhaserSlots = new Set<number>();
const prevShipStatuses = new Map<number, ShipStatus>();
let prevShieldsUp = false;
let prevAlertStatus = AlertStatus.GREEN;
let prevTractoring = false;
let prevPlasmaCount = 0;

const SOUNDS = [
  "nt_phaser",
  "nt_phaser_other",
  "nt_fire_torp",
  "nt_fire_torp_other",
  "nt_explosion",
  "nt_explosion_other",
  "nt_shield_up",
  "nt_shield_down",
  "nt_torp_hit",
  "nt_enter_ship",
  "nt_red_alert",
  "nt_tractor",
  "nt_plasma",
  "nt_plasma_other",
] as const;

type SoundName = (typeof SOUNDS)[number];

async function loadSound(name: string): Promise<void> {
  if (!audioCtx) return;
  try {
    const resp = await fetch(`/sounds/${name}.wav`);
    const arrayBuf = await resp.arrayBuffer();
    const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
    bufferCache.set(name, audioBuf);
  } catch {
    // Sound loading is non-critical
  }
}

export async function initSound(): Promise<void> {
  try {
    audioCtx = new AudioContext();
    await Promise.all(SOUNDS.map((s) => loadSound(s)));
  } catch {
    // Web Audio not available
  }
}

/** Resume audio context after user interaction (browser autoplay policy) */
export function resumeAudio(): void {
  if (audioCtx?.state === "suspended") {
    audioCtx.resume();
  }
}

export function playSound(name: string, volume = 0.5): void {
  play(name as SoundName, volume);
}

function play(name: SoundName, volume = 0.5): void {
  if (!audioCtx) return;
  const buf = bufferCache.get(name);
  if (!buf) return;

  const source = audioCtx.createBufferSource();
  source.buffer = buf;

  const gain = audioCtx.createGain();
  gain.gain.value = volume;
  source.connect(gain);
  gain.connect(audioCtx.destination);

  source.start();
}

/**
 * Process a game state snapshot and play sounds for new events.
 * Called once per server tick (not per render frame).
 */
export function processSounds(state: ClientGameState): void {
  if (!audioCtx) return;

  const mySlot = getMySlot();
  const myShip = state.ships.find((s) => s.slotIndex === mySlot);

  // --- Phasers ---
  const currentPhaserSlots = new Set(state.phasers.map((p) => p.ownerSlot));
  for (const slot of currentPhaserSlots) {
    if (!prevPhaserSlots.has(slot)) {
      if (slot === mySlot) {
        play("nt_phaser", 0.6);
      } else {
        play("nt_phaser_other", 0.3);
      }
    }
  }
  prevPhaserSlots = currentPhaserSlots;

  // --- Torpedoes (detect new torps by count increase) ---
  const currentTorpCount = state.torps.length;
  if (currentTorpCount > prevTorpCount) {
    const newTorps = currentTorpCount - prevTorpCount;
    // Check if any are ours
    const myTorps = state.torps.filter((t) => t.ownerSlot === mySlot);
    if (myTorps.length > 0) {
      play("nt_fire_torp", 0.4);
    } else if (newTorps > 0) {
      play("nt_fire_torp_other", 0.2);
    }
  }
  prevTorpCount = currentTorpCount;

  // --- Explosions (ships transitioning to EXPLODING) ---
  for (const ship of state.ships) {
    const prevStatus = prevShipStatuses.get(ship.slotIndex);
    if (
      ship.status === ShipStatus.EXPLODING &&
      prevStatus !== ShipStatus.EXPLODING
    ) {
      if (ship.slotIndex === mySlot) {
        play("nt_explosion", 0.7);
      } else {
        play("nt_explosion_other", 0.4);
      }
    }
  }
  // Update status tracking
  prevShipStatuses.clear();
  for (const ship of state.ships) {
    prevShipStatuses.set(ship.slotIndex, ship.status);
  }

  // --- Shield toggle (own ship only) ---
  if (myShip) {
    if (myShip.shieldsUp && !prevShieldsUp) {
      play("nt_shield_up", 0.4);
    } else if (!myShip.shieldsUp && prevShieldsUp) {
      play("nt_shield_down", 0.4);
    }
    prevShieldsUp = myShip.shieldsUp;

    // --- Alert status change ---
    if (
      myShip.alertStatus === AlertStatus.RED &&
      prevAlertStatus !== AlertStatus.RED
    ) {
      play("nt_red_alert", 0.5);
    }
    prevAlertStatus = myShip.alertStatus;

    // Tractor beam start (own ship only)
    if (myShip.tractoring && !prevTractoring) {
      play("nt_tractor", 0.5);
    }
    prevTractoring = myShip.tractoring;
  }

  // --- Plasma fire ---
  const currentPlasmaCount = state.plasmas.length;
  if (currentPlasmaCount > prevPlasmaCount) {
    const myPlasma = state.plasmas.find((p) => p.ownerSlot === mySlot);
    if (myPlasma) {
      play("nt_plasma", 0.6);
    } else {
      play("nt_plasma_other", 0.4);
    }
  }
  prevPlasmaCount = currentPlasmaCount;
}

export function resetSound(): void {
  prevTorpCount = 0;
  prevPhaserSlots.clear();
  prevShipStatuses.clear();
  prevShieldsUp = false;
  prevAlertStatus = AlertStatus.GREEN;
  prevTractoring = false;
  prevPlasmaCount = 0;
}
