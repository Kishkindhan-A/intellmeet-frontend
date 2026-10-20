# Exception handling

Updated 20 October 2026.

- Fetch and response-body failures use typed network/timeout errors. A timed-out mutation is never automatically replayed; users are asked to check persisted state before trying again. Malformed JSON remains a separate invalid-response error.
- Settings saves await their refresh callback and distinguish a successful write from a failed refresh. Refresh rejection is handled, and the save is not repeated.
- A React error boundary catches rendering and lazy-loading failures and offers an explicit reload action. It does not claim to catch event-handler errors, which still need their own try/catch.
- The backend delegates errors after headers have been sent to Express rather than writing a second response.
- Recognized MongoDB connectivity and Redis retry failures return HTTP 503 with a safe DEPENDENCY_UNAVAILABLE message and Retry-After. Unknown exceptions remain HTTP 500.
- Unexpected exception messages are not written to application error logs. Logs retain a safe category and request ID without provider credentials, tokens or connection strings.

## Validation

110 tests passed, including response-stream timeouts, no automatic mutation retry, late-response errors, dependency-outage categories and safe logs. Backend type checking/build and frontend build passed. Frontend lint has no errors and five existing warnings.

A temporary local browser fixture deliberately threw a render exception. The error boundary rendered the recovery message and Reload page button. The fixture was removed and its test server stopped afterward. Screenshot evidence is kept only in ignored local audit data, not committed.

Production service outages were not induced to test this change. Exception-path tests use controlled failures instead of disrupting the deployed database or Redis.
