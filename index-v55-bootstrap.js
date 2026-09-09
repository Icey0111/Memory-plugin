// Aetheria Unified Memory v5.5 — host bootstrap.
// Keeps the core staged entry point intact and layers host-facing UI localization/polish on top.
import { init as coreInit } from './index-v55.js';
import { installV55UiPolish, localizeV55Ui } from './v55-ui-polish.js';

function installUi() {
    installV55UiPolish();
    localizeV55Ui();
}

export function init() {
    const result = coreInit();
    installUi();
    for (const delay of [100, 350, 900, 1600, 2600]) setTimeout(installUi, delay);
    return result;
}

installUi();
for (const delay of [250, 900, 1800]) setTimeout(installUi, delay);
