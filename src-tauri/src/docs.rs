//! Opening documents, and the `doc:` URL scheme that lets the page load a document's
//! images, linked files and unpacked book contents straight from disk.

use std::borrow::Cow;
use std::path::{Component, Path, PathBuf};

use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS};
use serde::Serialize;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Runtime, UriSchemeContext, UriSchemeResponder};

use crate::epub;

/// Extensions the reader opens itself rather than handing to another app.
pub const READER_EXTENSIONS: &[&str] = &[
    "md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "mdtxt", "mdtext", "text", "txt", "epub",
];
pub const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "mdtxt", "mdtext"];

/// What a tab shows.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Document {
    #[serde(rename_all = "camelCase")]
    Markdown { path: String, name: String, dir: String, text: String, base: String },
    #[serde(rename_all = "camelCase")]
    Book { path: String, name: String, dir: String, #[serde(flatten)] book: epub::Book },
}

pub fn open(path: &Path) -> Result<Document, String> {
    let path = std::path::absolute(path).map_err(|e| e.to_string())?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let is_book = path.is_dir() || has_extension(&path, &["epub"]);
    let path_str = path.to_string_lossy().into_owned();
    let dir_str = dir.to_string_lossy().into_owned();

    if is_book {
        let book = epub::Book::open(&path)?;
        return Ok(Document::Book { path: path_str, name, dir: dir_str, book });
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Couldn't read “{name}”: {e}"))?;
    Ok(Document::Markdown {
        path: path_str,
        name,
        base: format!("{}/", url_for(&dir).trim_end_matches('/')),
        dir: dir_str,
        text: decode_text(&bytes),
    })
}

pub fn has_extension(path: &Path, exts: &[&str]) -> bool {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .is_some_and(|e| exts.contains(&e.as_str()))
}

/// UTF-8 (with or without a BOM) or UTF-16 with a BOM; anything else is read as lossy UTF-8.
pub fn decode_text(bytes: &[u8]) -> String {
    match bytes {
        [0xEF, 0xBB, 0xBF, rest @ ..] => String::from_utf8_lossy(rest).into_owned(),
        [0xFF, 0xFE, rest @ ..] => utf16(rest, u16::from_le_bytes),
        [0xFE, 0xFF, rest @ ..] => utf16(rest, u16::from_be_bytes),
        _ => String::from_utf8_lossy(bytes).into_owned(),
    }
}

fn utf16(bytes: &[u8], read: fn([u8; 2]) -> u16) -> String {
    let units: Vec<u16> = bytes.chunks_exact(2).map(|c| read([c[0], c[1]])).collect();
    String::from_utf16_lossy(&units)
}

// MARK: - URLs

/// The characters a browser escapes in a URL path, plus `%` so file names containing it survive.
/// Keeping this minimal makes our URLs match the ones the page computes for relative links.
const PATH_SET: &AsciiSet = &CONTROLS
    .add(b' ').add(b'"').add(b'#').add(b'<').add(b'>').add(b'?').add(b'`').add(b'{').add(b'}').add(b'%');

/// Where the webview sees the `doc` scheme: Windows' WebView2 only routes custom schemes as http hosts.
pub fn origin() -> &'static str {
    if cfg!(windows) { "http://doc.localhost" } else { "doc://localhost" }
}

pub fn url_for(path: &Path) -> String {
    let mut s = path.to_string_lossy().replace('\\', "/");
    if !s.starts_with('/') {
        s.insert(0, '/');
    }
    format!("{}{}", origin(), utf8_percent_encode(&s, PATH_SET))
}

/// The file a `doc:` URL points at, if it is one.
pub fn path_for_url(url: &str) -> Option<PathBuf> {
    let rest = url.strip_prefix(origin())?;
    let rest = rest.split(['#', '?']).next().unwrap_or("");
    path_for_url_path(rest)
}

fn path_for_url_path(encoded: &str) -> Option<PathBuf> {
    let decoded = percent_decode_str(encoded).decode_utf8().ok()?;
    let decoded: &str = &decoded;
    // "/C:/Users/…" on Windows; network shares arrive as "///server/share/…".
    let path = if cfg!(windows) { decoded.strip_prefix('/').unwrap_or(decoded) } else { decoded };
    if path.is_empty() {
        return None;
    }
    Some(PathBuf::from(path))
}

/// Removes `.` and `..` without touching the disk.
pub fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

// MARK: - Protocol

pub fn protocol<R: Runtime>(_ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    std::thread::spawn(move || responder.respond(serve(&request)));
}

fn serve(request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let reply = |status: StatusCode| Response::builder().status(status).body(Cow::Borrowed(&[][..])).unwrap();
    let Some(path) = path_for_url_path(request.uri().path()) else { return reply(StatusCode::BAD_REQUEST) };
    if !path.is_file() {
        return reply(StatusCode::NOT_FOUND);
    }
    match std::fs::read(&path) {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime_type(&path))
            .header(header::CACHE_CONTROL, "no-cache")
            .body(Cow::Owned(bytes))
            .unwrap(),
        Err(_) => reply(StatusCode::FORBIDDEN),
    }
}

fn mime_type(path: &Path) -> &'static str {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "tif" | "tiff" => "image/tiff",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "css" => "text/css",
        "html" | "htm" => "text/html",
        "xhtml" => "application/xhtml+xml",
        "xml" | "opf" | "ncx" => "application/xml",
        "json" => "application/json",
        "pdf" => "application/pdf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "md" | "markdown" | "txt" | "text" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_round_trip() {
        let p = if cfg!(windows) { PathBuf::from(r"C:\Users\me\My Docs\a#1 é.md") } else { PathBuf::from("/Users/me/My Docs/a#1 é.md") };
        let url = url_for(&p);
        assert!(!url.contains(' ') && !url.contains("#1"));
        assert_eq!(path_for_url(&url).unwrap().to_string_lossy().replace('\\', "/"), p.to_string_lossy().replace('\\', "/"));
        assert_eq!(path_for_url(&format!("{url}#frag")).unwrap().to_string_lossy().replace('\\', "/"), p.to_string_lossy().replace('\\', "/"));
    }

    #[test]
    fn normalizes() {
        assert_eq!(normalize(Path::new("a/b/../c/./d")), PathBuf::from("a/c/d"));
    }

    #[test]
    fn decodes_utf16() {
        let mut bytes = vec![0xFF, 0xFE];
        for u in "# Hi".encode_utf16() {
            bytes.extend(u.to_le_bytes());
        }
        assert_eq!(decode_text(&bytes), "# Hi");
    }
}
