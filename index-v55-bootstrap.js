// Aetheria Unified Memory v5.5 — host bootstrap.
// Store ownership guard is evaluated before the staged core so Canonical replay assignments cannot
// erase v5.5 module-owned chat state during initialization or later history reconciliation.
import { installV55StoreIntegrity } from './v55-store-integrity.js';
import { init as coreInit } from './index-v55.js';
import { installV55UiPolish, localizeV55Ui } from './v55-ui-polish.js';
import { syncFloorFoldDom } from './v55-floor-fold.js';
import { installV55DerivedStore, onDerivedHydrated } from './v55-derived-store.js';
import { installV55DirectApiSettings } from './v55-api-connections.js';
import { installV55PrivateVectorTransport, configurePrivateVectorTransport } from './v55-private-vector-transport.js';
import { installV55VectorPolicy, configureV55VectorPolicy } from './v55-vector-policy.js';
import { installV55EmbeddingProfileUi } from './v55-embedding-profile-ui.js';

let derivedListenerInstalled = false;

function installDerivedStore() {
    installV55DerivedStore();
    if (derivedListenerInstalled) return;
    derivedListenerInstalled = true;
    // Derived keys arrive asynchronously. Everything that reads them (the summary tree prompt, the
    // fold styling, the status line) has to be refreshed once they land, or the first generation after
    // a chat load would run against an empty derived state.
    onDerivedHydrated((ctx) => {
        const live = ctx || (globalThis.SillyTavern?.getContext?.());
        syncFloorFoldDom(live);
    });
}

function installUi() {
    installDerivedStore();
    installV55StoreIntegrity();
    installV55UiPolish();
    localizeV55Ui();
    installV55DirectApiSettings();
    configurePrivateVectorTransport();
    configureV55VectorPolicy();
    installV55EmbeddingProfileUi();
}

export function init() {
    installDerivedStore();
    installV55StoreIntegrity();
    installV55PrivateVectorTransport();
    installV55VectorPolicy();
    const result = coreInit();
    installUi();
    for (const delay of [100, 350, 900, 1600, 2600]) setTimeout(installUi, delay);
    return result;
}

installDerivedStore();
installV55StoreIntegrity();
installV55PrivateVectorTransport();
installV55VectorPolicy();
installUi();
for (const delay of [250, 900, 1800]) setTimeout(installUi, delay);
