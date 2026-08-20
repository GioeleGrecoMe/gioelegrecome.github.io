# Optional local AlvaAR runtime

V30.16.0 uses AlvaAR as the sole long-lived camera/world tracker.

For a self-contained/offline deployment copy the official AlvaAR distribution file:

    dist/alva_ar.js

into this directory as:

    v30/vendor/alva_ar.js

If the local file is absent the application tries the configured CDN URL. There is intentionally no optical-flow pose fallback when AlvaAR is unavailable or loses tracking: silently substituting another trajectory would destroy world persistence and corrupt downstream MVS/GS geometry.
