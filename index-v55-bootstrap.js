// Aetheria Unified Memory v5.5 — host bootstrap.
// Keeps the core staged entry point intact and layers host-facing UI/localization/summary/API services on top.
import { init as coreInit } from './index-v55.js';
import { installV55UiPolish, localizeV55Ui } from './v55-ui-polish.js';
import { installV55HierarchicalSummary } from './v55-summary-runtime.js';
import { installV55DirectApiSettings } from './v55-api-connections.js';
import { installV55PrivateVectorTransport, configurePrivateVectorTransport } from './v55-private-vector-transport.js';

function installUi() {
    installV55UiPolish();
    localizeV55Ui();
    installV55HierarchicalSummary();
    installV55DirectApiSettings();
    configurePrivateVectorTransport();
}

export function init() {
    // Install the request boundary before the mature core can build/query a derived vector index.
    // Only Aetheria collection IDs are rewritten; the host's own Vector Storage remains untouched.
    installV55PrivateVectorTransport();
    const result = coreInit();
    installUi();
    for (const delay of [100, 350, 900, 1600, 2600]) setTimeout(installUi, delay);
    return result;
}

installV55PrivateVectorTransport();
installUi();
for (const delay of [250, 900, 1800]) setTimeout(installUi, delay);
