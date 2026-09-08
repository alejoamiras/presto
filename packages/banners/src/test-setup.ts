import { GlobalRegistrator } from "@happy-dom/global-registrator";

// No network from tests: the element links Google Fonts into <head>, which happy-dom would fetch.
GlobalRegistrator.register({
  settings: {
    disableCSSFileLoading: true,
    disableJavaScriptFileLoading: true,
    disableJavaScriptEvaluation: true,
    handleDisabledFileLoadingAsSuccess: true,
  },
});
