import Foundation

/// Watches a single file and calls `onChange` when its contents change.
/// Survives editors that save by replacing the file (rename/delete + create).
final class FileWatcher {
    private let url: URL
    private let onChange: () -> Void
    private var source: DispatchSourceFileSystemObject?
    private var pending: DispatchWorkItem?

    init(url: URL, onChange: @escaping () -> Void) {
        self.url = url
        self.onChange = onChange
        arm()
    }

    deinit {
        source?.cancel()
    }

    private func arm(retries: Int = 20) {
        source?.cancel()
        source = nil

        let fd = open(url.path, O_EVTONLY)
        guard fd >= 0 else {
            if retries > 0 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in self?.arm(retries: retries - 1) }
            }
            return
        }

        let src = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .extend, .delete, .rename, .attrib],
            queue: .main
        )
        src.setEventHandler { [weak self, weak src] in
            guard let self, let src else { return }
            let flags = src.data
            if flags.contains(.delete) || flags.contains(.rename) {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in self?.arm() }
            }
            self.scheduleChange()
        }
        src.setCancelHandler { close(fd) }
        src.resume()
        source = src
    }

    private func scheduleChange() {
        pending?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.onChange() }
        pending = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: work)
    }
}
