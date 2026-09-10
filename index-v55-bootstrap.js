// Aetheria Unified Memory v5.5 — host bootstrap.
// Keeps the core staged entry point intact and layers host-facing UI/localization/summary/API services on top.
import { init as coreInit } from './index-v55.js';
import { installV55UiPolish, localizeV55Ui } from './v55-ui-polish.js';
import { installV55HierarchicalSummary } from './v55-summary-runtime.js';
import { installV55DirectApiSettings } from './v55-api-connections.js';
import { installV55PrivateVectorTransport, configurePrivateVectorTransport } from './v55-private-vector-transport.js';
import { installV55VectorPolicy, configureV55VectorPolicy } from './v55-vector-policy.js';
import { installV55EmbeddingProfileUi } from './v55-embedding-profile-ui.js';

function installUi() {
    installV55UiPolish();
    localizeV55Ui();
    installV55HierarchicalSummary();
    installV55DirectApiSettings();
    configurePrivateVectorTransport();
    configureV55VectorPolicy();
    installV55EmbeddingProfileUi();
}

export function init() {
    // Order matters: Iteration 08 remains the inner private-provider boundary; Iteration 09 wraps
    // it with representation-space/retrieval-policy semantics before the core builds or queries
    // Aetheria-owned derived vector collections.
    installV55PrivateVectorTransport();
    installV55VectorPolicy();
    const result = coreInit();
    installUi();
    for (const delay of [100, 350, 900, 1600, 2600]) setTimeout(installUi, delay);
    return result;
}

installV55PrivateVectorTransport();
installV55VectorPolicy();
installUi();
for (const delay of [250, 900, 1800]) setTimeout(installUi, delay);
