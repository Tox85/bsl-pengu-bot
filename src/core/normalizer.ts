// Utilitaires de normalisation pour éviter les erreurs de type
export function asLowerHexAddress(addr: string | { toString(): string }): string {
  return addr.toString().toLowerCase();
}

export function asString(value: string | { toString(): string }): string {
  return value.toString();
}
