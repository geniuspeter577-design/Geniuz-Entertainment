export type HomeCategoryRow<T> = {
  key: string;
  title: string;
  items: T[];
  emptyMessage: string;
  isLoading: boolean;
};

function createRandomGenerator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWithSeed<T>(items: readonly T[], seed: number): T[] {
  const shuffled = [...items];
  const random = createRandomGenerator(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function shuffleHomeCategoryRows<T>(
  rows: readonly HomeCategoryRow<T>[],
  seed: number,
): HomeCategoryRow<T>[] {
  const randomizedItems = rows.map((row, index) => ({
    ...row,
    items: shuffleWithSeed(row.items, (seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0),
  }));
  return shuffleWithSeed(randomizedItems, seed);
}

export function createHomeShuffleSeed(previousSeed?: number) {
  const seed = Math.floor(Math.random() * 0x100000000);
  return seed === previousSeed ? (seed + 1) >>> 0 : seed;
}
