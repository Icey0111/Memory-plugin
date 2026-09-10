// Aetheria v5.5 — legacy Tauri API compatibility shim.
// Iteration12 no longer needs a capture-phase bridge: v55-api-connections is Tauri-aware and
// stores Embedding credentials in Aetheria-owned storage. This shim intentionally performs no
// host secret writes, reads, rotations, or /api/secrets calls. It remains as a no-op export so
// older bootstrap/tests can import it safely during upgrades.
import { isNativeTauriTavern } from './v55-tauri-vector-backend.js';

let installed = false;

export function installV55TauriApiCompat() {
    installed = isNativeTauriTavern();
    return installed;
}

export function getV55TauriApiCompatStatus() {
    return {
        installed,
        active: installed && isNativeTauriTavern(),
        mode: 'retired-noop-aetheria-owned-credentials',
        host_secret_mutation: false,
    };
}
