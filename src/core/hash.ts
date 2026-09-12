export function hashKey(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function partitionForKey(key: string, partitionCount: number): number {
  if (partitionCount < 1) throw new Error("partition count must be positive");
  return hashKey(key) % partitionCount;
}
