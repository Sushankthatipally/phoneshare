// Deterministic adjective+noun device names. ~80 × 80 = 6,400 combinations.
// Seeded by a stable identifier (device fingerprint) so the same device always
// gets the same name across restarts.
import { createHash } from 'node:crypto';

const ADJECTIVES = [
  'Tidy', 'Fantastic', 'Quiet', 'Bright', 'Eager', 'Gentle', 'Brave', 'Calm',
  'Clever', 'Cosmic', 'Crisp', 'Dapper', 'Daring', 'Dashing', 'Dazzling', 'Dreamy',
  'Drifting', 'Earnest', 'Easy', 'Electric', 'Endless', 'Fierce', 'Floating', 'Fluffy',
  'Friendly', 'Frosty', 'Gleaming', 'Glowing', 'Golden', 'Graceful', 'Happy', 'Hidden',
  'Honest', 'Humble', 'Jolly', 'Jovial', 'Kind', 'Lively', 'Lucky', 'Lush',
  'Magic', 'Mellow', 'Merry', 'Mighty', 'Misty', 'Mystic', 'Nimble', 'Noble',
  'Plucky', 'Polished', 'Proud', 'Quick', 'Quirky', 'Radiant', 'Rapid', 'Restless',
  'Royal', 'Rustic', 'Savvy', 'Serene', 'Sharp', 'Shiny', 'Silent', 'Silver',
  'Smooth', 'Snappy', 'Sparkling', 'Spry', 'Steady', 'Stellar', 'Sturdy', 'Sunny',
  'Swift', 'Tame', 'Tender', 'Timid', 'Trusty', 'Vivid', 'Warm', 'Wise',
];

const NOUNS = [
  'Strawberry', 'Lettuce', 'Forest', 'Comet', 'Harbor', 'Lantern', 'Aurora', 'Badger',
  'Basket', 'Bay', 'Beacon', 'Berry', 'Birch', 'Blossom', 'Boulder', 'Branch',
  'Breeze', 'Brook', 'Cactus', 'Canyon', 'Cedar', 'Cherry', 'Cliff', 'Cloud',
  'Coast', 'Cove', 'Crane', 'Crescent', 'Crystal', 'Daisy', 'Dawn', 'Delta',
  'Drift', 'Dune', 'Eagle', 'Ember', 'Falcon', 'Fern', 'Field', 'Finch',
  'Flame', 'Foxglove', 'Garden', 'Geyser', 'Glacier', 'Glade', 'Granite', 'Grove',
  'Harvest', 'Heron', 'Hollow', 'Horizon', 'Island', 'Ivy', 'Juniper', 'Lagoon',
  'Lake', 'Lily', 'Lynx', 'Maple', 'Marsh', 'Meadow', 'Mesa', 'Mirage',
  'Moss', 'Mountain', 'Nebula', 'Olive', 'Orchard', 'Otter', 'Owl', 'Peak',
  'Pebble', 'Pine', 'Plateau', 'Pond', 'Quartz', 'Raven', 'Reef', 'Ridge',
];

function hashToInt(seed, salt) {
  const hash = createHash('sha256').update(`${seed}|${salt}`).digest();
  return hash.readUInt32BE(0);
}

export function generateFriendlyName(seed) {
  if (!seed) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    return `${adj} ${noun}`;
  }
  const adj = ADJECTIVES[hashToInt(seed, 'adj') % ADJECTIVES.length];
  const noun = NOUNS[hashToInt(seed, 'noun') % NOUNS.length];
  return `${adj} ${noun}`;
}

export function generateRandomFriendlyName() {
  return generateFriendlyName(null);
}

export function computeHashtag(seed) {
  if (!seed) return '#0000';
  const hash = createHash('sha256').update(seed).digest('hex');
  return `#${hash.slice(0, 4)}`;
}
