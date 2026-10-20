# LiveKit production setup

LiveKit Cloud project: IntellMeet (`p_2dbf8awm4hc`).
Endpoint: `wss://intellmeet-hni182ik.livekit.cloud`.

The project uses the Build plan; the dashboard showed a $0.00 next invoice during setup. Agent observability was disabled. No paid upgrade was selected.

Production Vercel secrets configured: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Credentials are held in Vercel, not this repository. Configuration deployed successfully in deployment `FznjqgMBHNW1AUwGupg9t1XZQbcX`.

## Verification on 20 October 2026

- Production readiness: HTTP 200.
- Registration, workspace creation, assigned-host meeting start, and admission succeeded in an isolated audit workspace.
- Media-token issuance succeeded and the browser entered the LiveKit connection flow.
- The in-app browser could not complete WebRTC: `RTCPeerConnection.setConfiguration` rejected a configuration update as unsupported. This is a browser-level failure; a full call has not been verified. Test in Chrome or Edge with two participants before declaring video fully verified.
- Camera and microphone stayed off. The audit meeting used confidential mode with recording and AI disabled.
- Application Socket.io live updates remain unavailable on the current deployment; periodic HTTP refresh is active. This is separate from LiveKit signaling/video.

Recording, egress storage, AI processing, and multi-participant audio/video have not been verified by this check.
