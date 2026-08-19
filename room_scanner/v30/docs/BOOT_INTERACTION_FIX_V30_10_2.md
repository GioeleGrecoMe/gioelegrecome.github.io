# V30.10.2 interaction boot fix

V30.10.1 rendered the home screen before the app was interactive and awaited a sequential full-asset preflight. A slow request/service-worker path could leave a visible page with no event handlers.

V30.10.2 imports the core first, binds controls before storage/service-worker awaits, isolates optional modules, runs bounded asset diagnostics later, and leaves emergency Diagnostics/Force Update handlers available before any ES module loads.
