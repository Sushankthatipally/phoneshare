// DropBeamTransferAttributes.swift
//
// Shared ActivityKit attributes used by the Live Activity widget extension
// AND by DropBeamLiveActivityModule. The widget renders the Dynamic Island
// + Lock Screen UI based on the ContentState below.

import ActivityKit
import Foundation

@available(iOS 16.1, *)
public struct DropBeamTransferAttributes: ActivityAttributes {
    public typealias TransferStatus = ContentState

    public struct ContentState: Codable, Hashable {
        public var bytesDone: Double
        public var speedLabel: String
        public var percent: Double

        public init(bytesDone: Double, speedLabel: String, percent: Double) {
            self.bytesDone = bytesDone
            self.speedLabel = speedLabel
            self.percent = percent
        }
    }

    public var fileName: String
    public var peerName: String
    public var totalBytes: Double

    public init(fileName: String, peerName: String, totalBytes: Double) {
        self.fileName = fileName
        self.peerName = peerName
        self.totalBytes = totalBytes
    }
}
