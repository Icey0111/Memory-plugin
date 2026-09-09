// v5.5 iteration07 staged entry point.
// Load the proven v5.4/v5.5-A..G runtime, then layer the v5.5 hardening/finalizer
// boundaries without rewriting the mature legacy entry point.
import { init } from './index.js';
import { installV55Runtime } from './v55-runtime.js';
import { installV55Finalizer } from './v55-finalizer.js';
import { installV55Consistency } from './v55-consistency.js';
import { installV55Provenance } from './v55-provenance.js';

const INTERCEPTOR_NAME = 'aetheriaUnifiedMemoryV54Interceptor';
const getContext = () => globalThis.SillyTavern?.getContext?.();
let stackInstalled = false;

function installAll() {
    if (stackInstalled) return true;
    const ctx = getContext();
    const base = globalThis[INTERCEPTOR_NAME];
    if (!ctx || typeof base !== 'function') return false;

    // Fixed order: compatibility runtime -> v5.5 feature finalizer -> post-runtime
    // consistency -> provenance event stabilizer. Install exactly once.
    installV55Runtime(getContext, INTERCEPTOR_NAME);
    installV55Finalizer(getContext, INTERCEPTOR_NAME);
    installV55Consistency(getContext, INTERCEPTOR_NAME);
    installV55Provenance(getContext);
    stackInstalled = true;
    return true;
}

installAll();
setTimeout(installAll, 50);
setTimeout(installAll, 800);
setTimeout(installAll, 1600);

export { init };
