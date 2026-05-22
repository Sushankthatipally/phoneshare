// DropBeamLiveActivityWidget.swift
//
// The actual Dynamic Island / Lock Screen UI for in-flight transfers.
// This file lives in a Widget Extension target so iOS can render it
// from the SpringBoard.

import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.1, *)
struct DropBeamLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DropBeamTransferAttributes.self) { context in
            // Lock-Screen / Banner UI
            LockScreenView(state: context.state, attrs: context.attributes)
                .activityBackgroundTint(Color.black)
                .activitySystemActionForegroundColor(Color.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label {
                        Text(context.attributes.peerName)
                            .font(.caption)
                    } icon: {
                        Image(systemName: "bolt.circle.fill")
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(Int(context.state.percent))%")
                        .font(.headline.monospacedDigit())
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.fileName)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ProgressView(value: context.state.percent / 100)
                        .progressViewStyle(.linear)
                        .tint(.white)
                    HStack {
                        Text(formatBytes(context.state.bytesDone))
                            .font(.caption2.monospacedDigit())
                        Spacer()
                        Text(context.state.speedLabel)
                            .font(.caption2.monospacedDigit())
                    }
                    .foregroundStyle(.secondary)
                }
            } compactLeading: {
                Image(systemName: "bolt.fill")
            } compactTrailing: {
                Text("\(Int(context.state.percent))%")
                    .font(.caption.monospacedDigit())
            } minimal: {
                Image(systemName: "bolt")
            }
        }
    }
}

@available(iOS 16.1, *)
private struct LockScreenView: View {
    let state: DropBeamTransferAttributes.ContentState
    let attrs: DropBeamTransferAttributes

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "bolt.fill")
                Text("DropBeam · \(attrs.peerName)")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(Int(state.percent))%")
                    .font(.headline.monospacedDigit())
            }

            Text(attrs.fileName)
                .lineLimit(1)
                .font(.body)

            ProgressView(value: state.percent / 100)
                .progressViewStyle(.linear)
                .tint(.white)

            HStack {
                Text(formatBytes(state.bytesDone))
                    .font(.caption.monospacedDigit())
                Spacer()
                Text(state.speedLabel)
                    .font(.caption.monospacedDigit())
            }
            .foregroundStyle(.secondary)
        }
        .padding()
    }
}

private func formatBytes(_ bytes: Double) -> String {
    if bytes <= 0 { return "0 B" }
    let units = ["B", "KB", "MB", "GB", "TB"]
    var value = bytes
    var idx = 0
    while value >= 1024, idx < units.count - 1 {
        value /= 1024
        idx += 1
    }
    return String(format: "%.1f %@", value, units[idx])
}
