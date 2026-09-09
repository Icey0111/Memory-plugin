// Aetheria Unified Memory v5.5 — host bootstrap.
// Keeps the core staged entry point intact and layers host-facing UI/localization/summary/API services on top.
import { init as coreInit } from './index-v55.js';
import { installV55UiPolish, localizeV55Ui } from './v55-ui-polish.js';
import { installV55HierarchicalSummary } from './v55-summary-runtime.js';
import { installV55DirectApiSettings } from './v55-api-connections.js';

function installUi() {
    installV55UiPolish();
    localizeV55Ui();
    installV55HierarchicalSummary();
    installV55DirectApiSettings();
}

export function init() {
    const result = coreInit();
    installUi();
    for (const delay of [100, 350, 900, 1600, 2600]) setTimeout(installUi, delay);
    return result;
}

installUi();
for (const delay of [250, 900, 1800]) setTimeout(installUi, delay);
