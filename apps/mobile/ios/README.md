# iOS Share Extension — DEFERRED

The W16 brief asks for a `DropBeamShareExtension` target that writes shared
files into an App Group container and surfaces them on the next launch of the
main app.

This requires:

- A second Xcode target with `Bundle Type = Action Extension` and a Share
  Extension entitlement.
- An App Group identifier (e.g. `group.com.dropbeam.share`) shared between the
  main app and the extension.
- A `NSExtensionPrincipalClass` Swift class implementing
  `SLComposeServiceViewController`.

None of these can be authored via the managed Expo config plugin pipeline this
project relies on — they need a manual Xcode project (`expo prebuild` produces
an `ios/` project but does not retain custom targets across rebuilds).

Until the project is fully ejected from Expo's prebuild step, the iOS share
sheet entry is intentionally absent. On Android, the share-sheet receive flow
is fully wired (see `app/share.tsx`, `src/screens/ShareReceiveScreen.tsx`,
`MainActivity.kt`, and `modules/dropbeam-android/.../DropBeamShareInbox.kt`).
