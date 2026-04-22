# Netrek Mechanics Reference

Detailed game mechanics compiled from original documentation. Supplements Spec.md with implementation-specific details and edge cases.

## Movement System

### Direction & Turning

- 256 discrete headings (0-255). Direction 0 = north, increases clockwise.
- Ships always move in the direction they face (boat-like steering).
- Turn rate formula: base rate halved per warp level above 0.
- At warp 0, ships turn nearly instantly. At max warp, turns are very slow.
- This is intentional: high speed = committed trajectory. Core tactical tradeoff.

### Speed & Acceleration

- Warp 0-12 range (ship-dependent max).
- Acceleration and deceleration are ship-dependent rates.
- Speed change is not instant — takes multiple ticks to reach desired warp.
- Hull damage reduces max warp proportionally.

### Galaxy Boundaries

- Ships bounce off galaxy walls without damage.
- Galaxy is 100,000 x 100,000 game units.
- Ships pass through each other without collision (no ship-to-ship physics).

## Weapon Systems

### Phasers

- Instantaneous hitscan. Cannot be dodged.
- Damage formula: `base_damage * (1 - distance / max_range)`
- At point blank: full damage. At max range: 0 damage.
- Practical minimum damage: ~20 points (beyond this, not worth the fuel)
- Fire rate: once per second (10 ticks). Starbases fire faster.
- Fuel cost: `7 * base_damage` for SC/DD/CA. Higher multiplier for BB/AS/SB.
- Hitting a cloaked ship reveals exact position ("phaser lock").

### Torpedoes

- Projectiles at fixed speed (ship-dependent).
- Max 8 torpedoes in flight per player simultaneously.
- Wobble randomly during flight (small random deflection per tick).
- Expire after random distance/time (~50-70 ticks with variance).
- Explode on: impact with enemy ship, galaxy wall, or enemy detonation.
- Impact radius: ~250 game units (ship shield radius).
- Splash damage: `base_damage * (2000 - distance) / 1650`
- At point blank (dist=0): ~121% of base damage.
- At max splash range (2000): 0 damage.
- Explosion damages all nearby ships EXCEPT the firer.
- Detonated torps: no damage to detonator's teammates, can damage firer's teammates.
- Fuel cost: `7 * base_damage` for SC/DD/CA. Higher for BB/AS/SB.

### Detonation

- Player action to explode nearby enemy torpedoes prematurely.
- Range: 1600 game units from detonating ship.
- Cost: 100 fuel per use.
- Heats weapons by 20 (regardless of whether anything was detonated).
- Damage to detonator: `torp_damage * (2000 - distance) / 1650`
- At max det range (1600): ~24.2% of nominal torp damage.
- Detonating early reduces damage taken vs letting torps hit.

### Plasma Torpedoes (Phase 2+)

- Require 2+ kills and DD/CA/BB hull.
- Fire forward from ship. Starbases can fire any direction (short range).
- Track target slightly (homing).
- Damage everyone nearby on explosion, including the firer.
- Can be destroyed by enemy phaser hit or ship impact.
- "SMACK!" — classic term for a plasma hit.

## Temperature System

### Engine Temperature

- Rises by: current warp level per tick.
- Additional +5/tick while tractor/pressor beam is active.
- Cooling rates per tick: SC=8, DD=7, CA/BB/AS/SB=6.
- Net temp change per tick: `speed - cooling_rate` (plus tractor heat if applicable).
- "Redlining" = running with engine temp near/above 95.

### Weapon Temperature

- Rises when firing weapons. Each weapon type has per-ship heat cost.
- Cools at same rates as engine temp.

### Overheat Mechanics (same for both engine and weapon)

- Threshold: 100 (SB weapon threshold: 130).
- When over threshold: 1/40 chance per tick of burnout.
- Burnout duration: 100 + random(0-149) ticks (10-25 seconds).
- Engine burnout: locked to warp 1, no tractor/pressor, can still steer and orbit.
- Weapon burnout: all weapons and detonation disabled.

## Shields & Repair

### Shield Mechanics

- Shields absorb damage before hull.
- Shield cost: per-tick fuel drain when shields are up (ship-dependent).
- Shields can be toggled on/off.

### Hull Damage

- Once shields are depleted, damage goes to hull.
- Hull damage reduces max warp speed proportionally.
- 50% hull damage ≈ 50% max speed. Creates "cripples."

### Repair

- Shield repair: constant rate per tick (ship-dependent base).
- Hull repair: half of shield repair rate, ONLY when shields are down.
- Repair mode toggle: doubles repair rate. Sets speed to 0, shields down.
- Orbiting friendly repair planet: 4x rate (stacks with repair mode).
- Docked at starbase: 5x rate (stacks with repair mode).

### Fuel Regeneration

- Normal: 2x base recharge rate per tick.
- Orbiting friendly fuel planet: 8x recharge.
- Docked at starbase (if SB has fuel): 12x recharge.

## Death & Respawn

### Explosion Damage

- Ship explosions damage nearby ships.
- SB explosion: 200 damage. SC: 75. All others: 100.
- Within 350 distance: full explosion damage.
- Beyond 350: `damage * (3000 - distance) / 2650`. Zero past 3000.
- Chain reactions possible (explosion kills nearby ship, which explodes, etc.).

### Respawn Rules

- On death: choose new ship type, appear near homeworld.
- Must wait for in-flight torpedoes to resolve before respawning.
- Ships that disconnect do NOT explode (no rage-quit explosion farming).

## Alert Status

- Determined by distance to nearest enemy ship.
- **Green**: No enemies nearby.
- **Yellow**: Enemy within 1/7 galaxy width (~14,286 units).
- **Red**: Enemy very close.
- Useful for detecting cloaked enemies (yellow alert = something nearby even if invisible).

## Kill Economy (Phase 2+)

- Kill value: `1.0 + 0.1 * (victim's kills) + 0.1 * (victim's armies carried)`
- 0.25 kills for capturing a planet.
- 0.02 kills per army bombed.
- Kills reset to 0 on death.
- Army carry capacity: `floor(kills * armies_per_kill)`, capped at ship max.
