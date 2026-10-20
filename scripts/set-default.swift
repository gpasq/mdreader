// Makes MDReader the default app for Markdown files.
// Usage: swift scripts/set-default.swift [path-to-MDReader.app]
// macOS may ask you to confirm the change.
import AppKit
import UniformTypeIdentifiers

let appURL = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "/Applications/MDReader.app")
let extensions = ["md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "mdtxt", "mdtext"]

var types: [UTType] = [UTType(importedAs: "net.daringfireball.markdown")]
for ext in extensions {
    if let t = UTType(filenameExtension: ext), !types.contains(t) { types.append(t) }
}

var failed = false
for type in types {
    let error: Error? = await withCheckedContinuation { done in
        NSWorkspace.shared.setDefaultApplication(at: appURL, toOpen: type) { done.resume(returning: $0) }
    }
    if let error {
        print("  \(type.identifier): \(error.localizedDescription)")
        failed = true
    } else {
        let ext = type.preferredFilenameExtension.map { " (.\($0))" } ?? ""
        print("  \(type.identifier)\(ext) → \(appURL.lastPathComponent)")
    }
}

// Confirm what Launch Services now resolves for Markdown files.
for ext in ["md"] {
    let probe = FileManager.default.temporaryDirectory.appendingPathComponent("mdreader-probe.\(ext)")
    try? Data().write(to: probe)
    let opener = NSWorkspace.shared.urlForApplication(toOpen: probe)?.path ?? "none"
    try? FileManager.default.removeItem(at: probe)
    print("  .\(ext) files now open with: \(opener)")
    if opener != appURL.path { failed = true }
}
exit(failed ? 1 : 0)
