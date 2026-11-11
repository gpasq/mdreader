import Compression
import Foundation

/// Just enough of the ZIP format to unpack an EPUB: stored and deflated entries, no ZIP64 or encryption.
enum ZipArchive {
    enum Failure: Error { case notAZip, unsupported(String), corrupt }

    /// Writes every entry of `data` under `directory`.
    static func extract(_ data: Data, to directory: URL) throws {
        let bytes = [UInt8](data)
        let eocd = try findEndOfCentralDirectory(bytes)
        let count = Int(u16(bytes, eocd + 10))
        var offset = Int(u32(bytes, eocd + 16))
        let fm = FileManager.default

        for _ in 0..<count {
            guard offset + 46 <= bytes.count, u32(bytes, offset) == 0x0201_4b50 else { throw Failure.corrupt }
            let flags = u16(bytes, offset + 8)
            let method = u16(bytes, offset + 10)
            let compressedSize = Int(u32(bytes, offset + 20))
            let size = Int(u32(bytes, offset + 24))
            let nameLength = Int(u16(bytes, offset + 28))
            let extraLength = Int(u16(bytes, offset + 30))
            let commentLength = Int(u16(bytes, offset + 32))
            let localOffset = Int(u32(bytes, offset + 42))
            guard offset + 46 + nameLength <= bytes.count else { throw Failure.corrupt }
            let name = String(decoding: bytes[(offset + 46)..<(offset + 46 + nameLength)], as: UTF8.self)
            offset += 46 + nameLength + extraLength + commentLength

            guard let target = safeURL(for: name, in: directory) else { continue }
            if name.hasSuffix("/") {
                try fm.createDirectory(at: target, withIntermediateDirectories: true)
                continue
            }
            if flags & 1 != 0 { throw Failure.unsupported("encrypted entries") }

            guard localOffset + 30 <= bytes.count, u32(bytes, localOffset) == 0x0403_4b50 else { throw Failure.corrupt }
            let start = localOffset + 30 + Int(u16(bytes, localOffset + 26)) + Int(u16(bytes, localOffset + 28))
            guard start + compressedSize <= bytes.count else { throw Failure.corrupt }
            let raw = bytes[start..<(start + compressedSize)]

            let contents: Data
            switch method {
            case 0: contents = Data(raw)
            case 8: contents = try inflate(raw, size: size)
            default: throw Failure.unsupported("compression method \(method)")
            }
            try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try contents.write(to: target)
        }
    }

    private static func findEndOfCentralDirectory(_ b: [UInt8]) throws -> Int {
        guard b.count >= 22 else { throw Failure.notAZip }
        let lowest = max(0, b.count - 22 - 0xFFFF)
        var i = b.count - 22
        while i >= lowest {
            if u32(b, i) == 0x0605_4b50 { return i }
            i -= 1
        }
        throw Failure.notAZip
    }

    private static func inflate(_ raw: ArraySlice<UInt8>, size: Int) throws -> Data {
        guard size > 0 else { return Data() }
        var out = Data(count: size)
        let written = raw.withUnsafeBufferPointer { src in
            out.withUnsafeMutableBytes { dst in
                compression_decode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, size,
                                          src.baseAddress!, src.count, nil, COMPRESSION_ZLIB)
            }
        }
        guard written == size else { throw Failure.corrupt }
        return out
    }

    /// Rejects absolute paths and `..` so an entry can't land outside `directory`.
    private static func safeURL(for name: String, in directory: URL) -> URL? {
        let parts = name.split(separator: "/", omittingEmptySubsequences: true)
        guard !name.hasPrefix("/"), !parts.isEmpty, !parts.contains("..") else { return nil }
        return parts.reduce(directory) { $0.appending(path: String($1), directoryHint: .notDirectory) }
    }

    private static func u16(_ b: [UInt8], _ i: Int) -> UInt16 {
        UInt16(b[i]) | UInt16(b[i + 1]) << 8
    }

    private static func u32(_ b: [UInt8], _ i: Int) -> UInt32 {
        UInt32(b[i]) | UInt32(b[i + 1]) << 8 | UInt32(b[i + 2]) << 16 | UInt32(b[i + 3]) << 24
    }
}
