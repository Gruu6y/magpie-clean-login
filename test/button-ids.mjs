// Every <button> id in ui/index.html, in one place.
//
// test/server.test.mjs and test/accounts-page-ui.test.mjs each used to inline
// their own copy of this list, in two different orders. Any pull request that
// added a button therefore collided with every other open pull request that
// touched the same tail of the array, and the merger had to rebase and merge
// the two lists by hand every time.
//
// This is now the only copy. Add a button here and both suites see it; there is
// no second list to keep in step.

export const buttonIds = [
  "tab-providers", "tab-proxies", "tab-accounts", "tab-guide", "retry", "add-proxy",
  "add-proxy-empty", "environment-prepare", "environment-cancel",
  "environment-retry", "filter-reset", "score-cancel", "proxy-close",
  "test-proxy", "proxy-cancel", "save-proxy", "confirm-close", "confirm-cancel",
  "confirm-action", "signin-close", "signin-cancel", "signin-close-footer",
  "signin-start", "signin-submit-code", "accounts-refresh",
  "accounts-import", "accounts-import-confirm", "accounts-import-cancel",
  "account-filter-all", "account-filter-signed-in", "account-filter-signed-out",
  "account-detail-close", "account-detail-dismiss", "account-detail-check",
  "account-detail-note-save", "account-check-close", "account-check-dismiss",
  "account-check-cancel", "account-check-reexit", "account-check-details",
  "account-check-change-exit", "account-check-start", "account-check-again",
  "account-check-retry",
  "account-hosting-close", "account-hosting-dismiss", "account-hosting-cancel",
  "account-hosting-run", "account-hosting-toggle",
  "hosting-alert-open", "hosting-alert-dismiss",
  "report-close", "report-cancel", "report-copy-body", "report-open",
];
