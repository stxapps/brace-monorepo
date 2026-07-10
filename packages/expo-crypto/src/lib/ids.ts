import { randomUUID } from 'react-native-quick-crypto';

// ID helpers — the Expo sibling of web-crypto's ids.ts. React Native has no
// crypto.randomUUID global, so this comes from quick-crypto's native CSPRNG;
// same UUID v4 format as every other platform's newId.
export function newId(): string {
  return randomUUID();
}
