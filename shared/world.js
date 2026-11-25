export const BOUNDS = 23;
export const GUIDE = { x: -4, z: -3 };
export const SENTINEL = { x: 5, z: -6, maxHp: 6 };
export const SPAWN = { x: 0, z: 5 };
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
