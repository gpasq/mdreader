//! EPUB books: unpacking, the package file, and the table of contents.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use percent_encoding::percent_decode_str;
use roxmltree::{Document, Node, ParsingOptions};
use serde::Serialize;

use crate::docs::{decode_text, normalize, url_for};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    /// Names the unpacked folder so the page can ask for it to be removed; `None` for a book read in place.
    pub book_id: Option<String>,
    pub title: Option<String>,
    pub author: Option<String>,
    pub base: String,
    pub chapters: Vec<Chapter>,
    pub toc: Vec<TocEntry>,
}

#[derive(Serialize)]
pub struct Chapter {
    pub url: String,
    pub html: String,
}

#[derive(Serialize)]
pub struct TocEntry {
    pub title: String,
    pub level: u32,
    pub href: String,
}

/// Where zipped books are unpacked while they are open.
pub fn books_dir() -> PathBuf {
    std::env::temp_dir().join("MDReader-Books")
}

/// Removes an unpacked book. Only folders inside `books_dir` are touched.
pub fn discard(book_id: &str) {
    if !book_id.is_empty() && book_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        let _ = std::fs::remove_dir_all(books_dir().join(book_id));
    }
}

impl Book {
    /// Reads a zipped `.epub`, or an unpacked EPUB folder in place.
    pub fn open(path: &Path) -> Result<Book, String> {
        if path.is_dir() {
            return Self::read(path, None);
        }
        let id = new_id();
        let root = books_dir().join(&id);
        let result = extract(path, &root).and_then(|_| Self::read(&root, Some(id.clone())));
        if result.is_err() {
            discard(&id);
        }
        result
    }

    fn read(root: &Path, book_id: Option<String>) -> Result<Book, String> {
        const MISSING: &str = "This EPUB has no package file (META-INF/container.xml is missing or invalid).";
        let container = read_xml(&root.join("META-INF").join("container.xml")).ok_or(MISSING)?;
        let full_path = with_doc(&container, |doc| {
            first(doc.root(), "rootfile").and_then(|n| attr(n, "full-path")).map(str::to_owned)
        })
        .flatten()
        .ok_or(MISSING)?;
        let opf_path = normalize(&root.join(decode_href(&full_path)));
        let opf = read_xml(&opf_path).ok_or(MISSING)?;

        struct Item { path: PathBuf, media_type: String, properties: String }
        struct Package { title: Option<String>, author: Option<String>, manifest: Vec<(String, Item)>, spine: Vec<String>, toc_id: Option<String> }

        let package = with_doc(&opf, |doc| {
            let metadata = first(doc.root(), "metadata");
            let meta_text = |name| metadata.and_then(|m| first(m, name)).map(text).filter(|s| !s.is_empty());
            let opf_dir = opf_path.parent().unwrap_or(root);
            let manifest = first(doc.root(), "manifest")
                .map(|m| {
                    descendants(m, "item")
                        .filter_map(|n| {
                            let id = attr(n, "id")?.to_owned();
                            let href = attr(n, "href")?;
                            Some((id, Item {
                                path: normalize(&opf_dir.join(decode_href(href))),
                                media_type: attr(n, "media-type").unwrap_or("").to_owned(),
                                properties: attr(n, "properties").unwrap_or("").to_owned(),
                            }))
                        })
                        .collect()
                })
                .unwrap_or_default();
            let spine_node = first(doc.root(), "spine");
            Package {
                title: meta_text("title"),
                author: meta_text("creator"),
                manifest,
                spine: spine_node
                    .map(|s| descendants(s, "itemref").filter_map(|n| attr(n, "idref").map(str::to_owned)).collect())
                    .unwrap_or_default(),
                toc_id: spine_node.and_then(|s| attr(s, "toc")).map(str::to_owned),
            }
        })
        .ok_or(MISSING)?;

        let item = |id: &str| package.manifest.iter().find(|(k, _)| k == id).map(|(_, v)| v);
        let chapters: Vec<Chapter> = package
            .spine
            .iter()
            .filter_map(|id| item(id))
            .filter(|i| i.media_type.contains("html"))
            .filter_map(|i| {
                let bytes = std::fs::read(&i.path).ok()?;
                Some(Chapter { url: url_for(&i.path), html: decode_text(&bytes) })
            })
            .collect();
        if chapters.is_empty() {
            return Err("This EPUB has no readable chapters.".into());
        }

        // EPUB 3 navigation document first, then the EPUB 2 NCX.
        let mut toc = package
            .manifest
            .iter()
            .find(|(_, i)| i.properties.split_whitespace().any(|p| p == "nav"))
            .map(|(_, i)| nav_toc(&i.path))
            .unwrap_or_default();
        if toc.is_empty() {
            let ncx = package
                .toc_id
                .as_deref()
                .and_then(item)
                .or_else(|| package.manifest.iter().map(|(_, i)| i).find(|i| i.media_type == "application/x-dtbncx+xml"));
            if let Some(ncx) = ncx {
                toc = ncx_toc(&ncx.path);
            }
        }

        Ok(Book {
            book_id,
            title: package.title,
            author: package.author,
            base: format!("{}/", url_for(root).trim_end_matches('/')),
            chapters,
            toc,
        })
    }
}

fn nav_toc(path: &Path) -> Vec<TocEntry> {
    let Some(source) = read_xml(path) else { return vec![] };
    with_doc(&source, |doc| {
        let navs: Vec<Node> = descendants(doc.root(), "nav").collect();
        let nav = navs
            .iter()
            .find(|n| attr(**n, "type").is_some_and(|t| t.split_whitespace().any(|t| t == "toc")))
            .or(navs.first());
        let Some(list) = nav.and_then(|n| first(*n, "ol")) else { return vec![] };
        let mut entries = vec![];
        fn walk(ol: Node, level: u32, path: &Path, entries: &mut Vec<TocEntry>) {
            for li in ol.children().filter(|n| n.tag_name().name() == "li") {
                if let Some(a) = li.children().find(|n| n.tag_name().name() == "a") {
                    if let (Some(href), title) = (attr(a, "href").and_then(|h| resolve(path, h)), text(a)) {
                        if !title.is_empty() {
                            entries.push(TocEntry { title, level, href });
                        }
                    }
                }
                if let Some(sub) = li.children().find(|n| n.tag_name().name() == "ol") {
                    walk(sub, level + 1, path, entries);
                }
            }
        }
        walk(list, 1, path, &mut entries);
        entries
    })
    .unwrap_or_default()
}

fn ncx_toc(path: &Path) -> Vec<TocEntry> {
    let Some(source) = read_xml(path) else { return vec![] };
    with_doc(&source, |doc| {
        let Some(map) = first(doc.root(), "navMap") else { return vec![] };
        let mut entries = vec![];
        fn walk(node: Node, level: u32, path: &Path, entries: &mut Vec<TocEntry>) {
            for point in node.children().filter(|n| n.tag_name().name() == "navPoint") {
                let href = first(point, "content").and_then(|c| attr(c, "src")).and_then(|s| resolve(path, s));
                let title = first(point, "navLabel").map(text).unwrap_or_default();
                if let (Some(href), false) = (href, title.is_empty()) {
                    entries.push(TocEntry { title, level, href });
                }
                walk(point, level + 1, path, entries);
            }
        }
        walk(map, 1, path, &mut entries);
        entries
    })
    .unwrap_or_default()
}

/// A `doc:` URL for `href` as written in the file at `from`, keeping any fragment.
fn resolve(from: &Path, href: &str) -> Option<String> {
    if href.contains("://") || href.starts_with("mailto:") {
        return None;
    }
    let (page, fragment) = href.split_once('#').map_or((href, None), |(p, f)| (p, Some(f)));
    let target = if page.is_empty() { from.to_path_buf() } else { normalize(&from.parent()?.join(decode_href(page))) };
    let mut url = url_for(&target);
    if let Some(fragment) = fragment {
        url.push('#');
        url.push_str(fragment);
    }
    Some(url)
}

fn decode_href(href: &str) -> PathBuf {
    let decoded = percent_decode_str(href).decode_utf8_lossy();
    PathBuf::from(decoded.split('/').collect::<Vec<_>>().join(std::path::MAIN_SEPARATOR_STR))
}

// MARK: - Unzipping

fn extract(epub: &Path, to: &Path) -> Result<(), String> {
    let fail = |e: &dyn std::fmt::Display| format!("Couldn't open this EPUB: {e}");
    let file = File::open(epub).map_err(|e| fail(&e))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| fail(&e))?;
    std::fs::create_dir_all(to).map_err(|e| fail(&e))?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| fail(&e))?;
        // `enclosed_name` rejects absolute paths and `..`, so nothing lands outside the folder.
        let Some(relative) = entry.enclosed_name() else { continue };
        let target = to.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| fail(&e))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| fail(&e))?;
        }
        let mut out = File::create(&target).map_err(|e| fail(&e))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| fail(&e))?;
    }
    Ok(())
}

fn new_id() -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}-{:x}-{}", std::process::id(), nanos, SEQ.fetch_add(1, Ordering::Relaxed))
}

// MARK: - XML

fn read_xml(path: &Path) -> Option<String> {
    std::fs::read(path).ok().map(|b| decode_text(&b))
}

/// Parses `source` and runs `f` on it. XHTML files often use HTML entities such as `&nbsp;`
/// that plain XML doesn't define, so a failed parse is retried with those replaced.
fn with_doc<T>(source: &str, f: impl Fn(&Document) -> T) -> Option<T> {
    let options = || ParsingOptions { allow_dtd: true, ..ParsingOptions::default() };
    if let Ok(doc) = Document::parse_with_options(source, options()) {
        return Some(f(&doc));
    }
    let cleaned = replace_html_entities(source);
    Document::parse_with_options(&cleaned, options()).ok().map(|doc| f(&doc))
}

fn replace_html_entities(s: &str) -> String {
    const KNOWN: &[(&str, &str)] = &[
        ("nbsp", "&#160;"), ("mdash", "&#8212;"), ("ndash", "&#8211;"), ("hellip", "&#8230;"),
        ("lsquo", "&#8216;"), ("rsquo", "&#8217;"), ("ldquo", "&#8220;"), ("rdquo", "&#8221;"),
        ("copy", "&#169;"), ("reg", "&#174;"), ("trade", "&#8482;"), ("shy", "&#173;"),
    ];
    const XML: &[&str] = &["amp", "lt", "gt", "quot", "apos"];
    // Drop the DOCTYPE too: its external DTD is what declared those entities.
    let mut rest = match (s.find("<!DOCTYPE"), s.find("<!doctype")) {
        (Some(i), _) | (None, Some(i)) => {
            let end = s[i..].find('>').map_or(s.len(), |e| i + e + 1);
            format!("{}{}", &s[..i], &s[end..])
        }
        _ => s.to_owned(),
    };
    let mut out = String::with_capacity(rest.len());
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i + 1..];
        let name_len = tail.find(';').filter(|&n| n > 0 && n < 12 && tail[..n].chars().all(|c| c.is_ascii_alphanumeric()));
        match name_len {
            Some(n) if !XML.contains(&&tail[..n]) => {
                out.push_str(KNOWN.iter().find(|(k, _)| *k == &tail[..n]).map_or(" ", |(_, v)| v));
                rest = tail[n + 1..].to_owned();
            }
            _ => {
                out.push('&');
                rest = tail.to_owned();
            }
        }
    }
    out.push_str(&rest);
    out
}

fn attr<'a>(node: Node<'a, '_>, local: &str) -> Option<&'a str> {
    node.attributes().find(|a| a.name() == local).map(|a| a.value())
}

fn first<'a, 'i>(node: Node<'a, 'i>, local: &str) -> Option<Node<'a, 'i>> {
    node.descendants().skip(1).find(|n| n.is_element() && n.tag_name().name() == local)
}

fn descendants<'a, 'i: 'a>(node: Node<'a, 'i>, local: &'a str) -> impl Iterator<Item = Node<'a, 'i>> + 'a {
    node.descendants().skip(1).filter(move |n| n.is_element() && n.tag_name().name() == local)
}

/// All text inside `node`, with runs of whitespace collapsed.
fn text(node: Node) -> String {
    let raw: String = node.descendants().filter(|n| n.is_text()).filter_map(|n| n.text()).collect();
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn entities() {
        let fixed = replace_html_entities("<!DOCTYPE html><p>a&nbsp;b &amp; c&foo;d</p>");
        assert_eq!(fixed, "<p>a&#160;b &amp; c d</p>");
    }

    #[test]
    fn reads_a_book() {
        let dir = std::env::temp_dir().join(format!("mdreader-test-{}", new_id()));
        let epub = dir.join("t.epub");
        std::fs::create_dir_all(&dir).unwrap();
        let mut zip = zip::ZipWriter::new(File::create(&epub).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        let files = [
            ("mimetype", "application/epub+zip"),
            ("META-INF/container.xml", r#"<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#),
            ("OEBPS/content.opf", r#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title> A  Book </dc:title><dc:creator>Someone</dc:creator></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="text/ch%201.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>"#),
            ("OEBPS/nav.xhtml", r#"<?xml version="1.0"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="text/ch%201.xhtml#s1">One&nbsp;Start</a><ol><li><a href="text/ch%201.xhtml#s2">Sub</a></li></ol></li></ol></nav></body></html>"#),
            ("OEBPS/text/ch 1.xhtml", "<html><body><h1 id=\"s1\">One</h1><h2 id=\"s2\">Sub</h2></body></html>"),
        ];
        for (name, body) in files {
            zip.start_file(name, opts).unwrap();
            zip.write_all(body.as_bytes()).unwrap();
        }
        zip.finish().unwrap();

        let book = Book::open(&epub).unwrap();
        assert_eq!(book.title.as_deref(), Some("A Book"));
        assert_eq!(book.author.as_deref(), Some("Someone"));
        assert_eq!(book.chapters.len(), 1);
        assert!(book.chapters[0].url.ends_with("/OEBPS/text/ch%201.xhtml"), "{}", book.chapters[0].url);
        assert_eq!(book.toc.len(), 2);
        assert_eq!(book.toc[0].title, "One Start");
        assert_eq!(book.toc[1].level, 2);
        assert_eq!(book.toc[0].href, format!("{}#s1", book.chapters[0].url));
        discard(book.book_id.as_deref().unwrap());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
