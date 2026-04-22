# Netrek Ship Details

## Ship Stats Table

From the original Netrek documentation. These are the authoritative values for our implementation.

| Stat             | SC   | DD   | CA    | BB    | AS   | SB    |
| ---------------- | ---- | ---- | ----- | ----- | ---- | ----- |
| Max Speed        | 12   | 10   | 9     | 8     | 8    | 2     |
| Cruise Speed     | 8    | 7    | 6     | 4     | 8    | 2     |
| Combat Speed     | 6    | 5    | 4     | 3     | 4    | 2     |
| Shields          | 75   | 85   | 100   | 130   | 80   | 500   |
| Hull             | 75   | 85   | 100   | 130   | 200  | 600   |
| Fuel             | 5000 | 7000 | 10000 | 14000 | 6000 | 60000 |
| Max Armies       | 2    | 5    | 10    | 6     | 20   | 25    |
| Armies/Kill      | 2    | 1.67 | 2     | 2     | 3    | N/A   |
| Torp Speed       | 16   | 14   | 12    | 12    | 16   | 14    |
| Torp Damage      | 25   | 30   | 40    | 40    | 30   | 30    |
| Phaser Damage    | 75   | 85   | 100   | 105   | 80   | 120   |
| Max Phaser Range | 4500 | 5100 | 6000  | 6300  | 4800 | 7200  |
| Shield Cost/tick | 2    | 3    | 3     | 3     | 3    | 6     |
| Tractor Strength | 2000 | 2500 | 3000  | 3700  | 2500 | 8000  |
| Tractor Range    | 0.7  | 0.9  | 1.0   | 1.2   | 0.7  | 1.5   |

## Ship Roles

### Scout (SC) - Key: S

Fast, fragile. Used for bombing, harassment, scouting. Fastest ship (warp 12). Lowest shields/hull. Only carries 2 armies. Best for deep bombing runs where speed keeps you alive.

### Destroyer (DD) - Key: D

Faster than CA but weaker. Specialty planet-taking ship for experienced pilots. 15 less phaser damage than CA. 30-point torps vs CA's 40-point. Carries 5 armies. Good for fast surgical planet takes.

### Cruiser (CA) - Key: C

The default ship. Balanced all-rounder. Heart of the game. Recommended for learning. 100/100 shields/hull, 40-point torps, 100-point phasers. Carries 10 armies. The benchmark all other ships are compared against.

### Battleship (BB) - Key: B

Slow, heavily armed and armored. 130/130 shields/hull. Best firepower (105 phaser, 40 torp). Only warp 8 max, warp 3 combat speed. Used for point defense and area denial. Slow turning at speed makes it predictable.

### Assault Ship (AS) - Key: A

Planet capture specialist. 200 hull (toughest non-SB), only 80 shields. 20 army capacity with 3 armies per kill. Fuel-efficient cloaking. The designated carrier for serious planet-taking operations. Weak weapons.

### Starbase (SB) - Key: O

Slow fortress. Max warp 2. 500 shields, 600 hull, 60,000 fuel. One per team. Requires 5+ owned planets and Commander rank. 30-minute rebuild timer on death. Other ships can dock for rapid refueling/repair. 120-point phaser damage.

Special SB traits:

- Can fire plasma in any direction (other ships fire forward only)
- 130 weapon temp overheat threshold (vs 100 for other ships)
- Faster phaser fire rate than other ships
- Docked ships repair/refuel at 5x/12x rates

## Combat Speeds

The three speed tiers matter for tactics:

- **Max Speed**: Sprint speed. Poor turning. Used for fleeing or straight-line charges.
- **Cruise Speed**: Travel speed. Moderate turning. Used for crossing the galaxy.
- **Combat Speed**: Dogfight speed. Best turning. Recommended max during engagements.

Rule of thumb from experienced players: "Warp 4 is probably the fastest you should go during battle" (for CA). Each warp above combat speed dramatically reduces dodge ability.

## Fuel Economy

Ships generate fuel passively. Fuel consumption:

- Shields: cost per tick (ship-dependent, see table)
- Weapons: 7x damage for SC/DD/CA phaser fuel cost. Higher multiplier for BB/AS/SB.
- Torps: same 7x formula for SC/DD/CA. Higher for others.
- Cloaking: fuel per tick (ship-dependent)
- High-speed travel: fuel per tick proportional to speed
- Tractor/Pressor: 200 fuel/second

Running out of fuel prevents weapon firing and severely limits options.

## Hull Damage Effects

Hull damage directly reduces maximum warp speed proportionally. A ship with 50% hull damage has roughly 50% of its max speed available. This creates "cripples" — heavily damaged ships that can't escape and are easy kills.
