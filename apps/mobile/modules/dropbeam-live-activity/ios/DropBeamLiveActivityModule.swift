// DropBeamLiveActivityModule.swift
//
// Bridges JavaScript ↔ ActivityKit so transfer progress shows up in the iOS
// Dynamic Island and on the Lock Screen via a Live Activity.
//
// Hook up from JS:
//   import { NativeModules } from 'react-native';
//   NativeModules.DropBeamLiveActivity.start({ fileName, totalBytes });
//   NativeModules.DropBeamLiveActivity.update({ bytesDone, speedLabel });
//   NativeModules.DropBeamLiveActivity.end();

import ActivityKit
import ExpoModulesCore
import Foundation

@available(iOS 16.1, *)
public class DropBeamLiveActivityModule: Module {
    private var activity: Activity<DropBeamTransferAttributes>?

    public func definition() -> ModuleDefinition {
        Name("DropBeamLiveActivity")

        AsyncFunction("isSupported") { () -> Bool in
            if #available(iOS 16.1, *) {
                return ActivityAuthorizationInfo().areActivitiesEnabled
            }
            return false
        }

        AsyncFunction("start") { (input: [String: Any], promise: Promise) in
            guard #available(iOS 16.1, *), ActivityAuthorizationInfo().areActivitiesEnabled else {
                promise.reject("UNSUPPORTED", "Live Activities are not supported or enabled")
                return
            }

            let fileName = (input["fileName"] as? String) ?? "Transfer"
            let totalBytes = (input["totalBytes"] as? Double) ?? 0
            let peerName = (input["peerName"] as? String) ?? "DropBeam"

            let attributes = DropBeamTransferAttributes(
                fileName: fileName,
                peerName: peerName,
                totalBytes: totalBytes
            )
            let state = DropBeamTransferAttributes.ContentState(
                bytesDone: 0,
                speedLabel: "Connecting…",
                percent: 0
            )

            do {
                let activity = try Activity<DropBeamTransferAttributes>.request(
                    attributes: attributes,
                    contentState: state,
                    pushType: nil
                )
                self.activity = activity
                promise.resolve(activity.id)
            } catch {
                promise.reject("START_FAILED", error.localizedDescription)
            }
        }

        AsyncFunction("update") { (input: [String: Any], promise: Promise) in
            guard let activity = self.activity else {
                promise.reject("NO_ACTIVITY", "No active Live Activity to update")
                return
            }

            let bytesDone = (input["bytesDone"] as? Double) ?? 0
            let speedLabel = (input["speedLabel"] as? String) ?? ""
            let percent = (input["percent"] as? Double) ?? 0

            let state = DropBeamTransferAttributes.ContentState(
                bytesDone: bytesDone,
                speedLabel: speedLabel,
                percent: percent
            )

            Task {
                if #available(iOS 16.2, *) {
                    await activity.update(ActivityContent(state: state, staleDate: nil))
                } else if #available(iOS 16.1, *) {
                    await activity.update(using: state)
                }
                promise.resolve(nil)
            }
        }

        AsyncFunction("end") { (promise: Promise) in
            guard let activity = self.activity else {
                promise.resolve(nil)
                return
            }

            let finalState = DropBeamTransferAttributes.ContentState(
                bytesDone: activity.contentState.bytesDone,
                speedLabel: "Complete",
                percent: 100
            )

            Task {
                if #available(iOS 16.2, *) {
                    await activity.end(
                        ActivityContent(state: finalState, staleDate: nil),
                        dismissalPolicy: .after(.now + 4)
                    )
                } else if #available(iOS 16.1, *) {
                    await activity.end(using: finalState, dismissalPolicy: .default)
                }
                self.activity = nil
                promise.resolve(nil)
            }
        }
    }
}
