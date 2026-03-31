---
name: book-fetch
description: Search for ebooks on libgen, download EPUBs, and optionally deliver them to an e-reader or Calibre library. Infrastructure-agnostic — discovers the user's setup at runtime.
---

# Book Fetch Skill

Search libgen for ebooks, download them as EPUBs, and deliver them to the user's reading setup.

## Trigger

When the user asks to find, download, or send a book to their e-reader. Examples:
- "Find me The Name of the Wind in epub"
- "Download and send X to my Kindle/PocketBook/Kobo"
- "Add these books to my Calibre library"

## Workflow

### 1. Clarify what to fetch

Get from the user:
- Book title(s) and author(s)
- Preferred format (default: EPUB)
- Where to deliver (local download, Calibre, e-reader email, etc.)

### 2. Find a working libgen mirror

Test mirrors in order until one responds:

```
libgen.li, libgen.is, libgen.rs, libgen.st, library.lol
```

Test with: `curl -sI --max-time 5 "https://{mirror}/"` — accept any 2xx/3xx.

If running on a remote server (e.g. via SSH), test from that server, not locally.

### 3. Search libgen

Search URL pattern for `libgen.li`:
```
https://libgen.li/index.php?req={query}&columns%5B%5D=t&columns%5B%5D=a&objects%5B%5D=f&topics%5B%5D=l&topics%5B%5D=f&res=25&filesuns=all
```

Parse results to find entries matching the desired format. Extract MD5 hashes from `md5=` parameters in the HTML.

**Selecting the best result:** Prefer files in the 300KB–5MB range for EPUBs. Files under 10KB are likely error pages. Multiple results for the same book are common — pick the one closest to a reasonable size.

### 4. Download

For each MD5:

1. Fetch the ads/detail page: `https://libgen.li/ads.php?md5={md5}`
2. Extract the download link: look for `get.php?md5={md5}&key={key}` in the HTML
3. Download: `curl -sL --max-time 120 -H "User-Agent: Mozilla/5.0" -o "{filename}" "https://libgen.li/get.php?md5={md5}&key={key}"`
4. Validate: file must be >10KB, must not start with `<html` (error page)
5. If download fails, retry with the next MD5 from the search results

Add a 1–2 second delay between downloads to be respectful.

### 5. Deliver

Delivery depends on the user's setup. **Discover infrastructure, don't assume it.**

#### Option A: Local file
Just tell the user where the files are.

#### Option B: Calibre library
If the user has Calibre running:
```bash
calibredb add "{file}" --with-library http://localhost:{port}
# or without --with-library if no server is running
```
Discover the port by checking running processes or Docker containers.

#### Option C: Email to e-reader
If the user wants to send to an e-reader (Kindle, PocketBook, Kobo, etc.), you need:
- **SMTP credentials** — check for existing config in:
  - Readarr notifications (`sqlite3 readarr.db "SELECT Settings FROM Notifications"`)
  - Calibre-web settings
  - LazyLibrarian config
  - Environment variables
  - Or ask the user
- **Device email address** — e.g. `@kindle.com`, `@pbsync.com`, `@rakuten.com`

Send via Python's `smtplib`:
- Batch attachments to stay under 20MB per email
- Use `application/epub+zip` MIME type for EPUBs
- Use `application/x-mobipocket-ebook` for MOBI/AZW

#### Option D: OPDS / LazyLibrarian
If LazyLibrarian or similar is running, place files in its watch directory.

## Error Handling

- **SSL cert errors on mirrors:** Try disabling cert validation or use HTTP fallback. Libgen mirrors frequently have mismatched certs.
- **Download returns HTML:** The key expired or the mirror is overloaded. Retry with a fresh key from the ads page, or try a different MD5.
- **Rate limiting:** If downloads stall, increase delay between requests to 3–5 seconds.
- **No results:** Try broader search terms (drop subtitle, use last name only). Try both "libgen" and "fiction" topic filters.

## Example Session

```
User: "Can you get me the Stormlight Archive series?"

1. Search libgen for each book:
   - The Way of Kings - Brandon Sanderson
   - Words of Radiance - Brandon Sanderson
   - Oathbringer - Brandon Sanderson
   - Rhythm of War - Brandon Sanderson

2. Download 4 EPUBs

3. Ask user: "Where should I send these? I can see you have
   Calibre running and a PocketBook email configured in Readarr."

4. Send to the chosen destination
```

## Important Notes

- This skill is for personal use with books the user owns or has a right to access.
- When searching, be a good librarian — if the user is vague ("something like Red Rising"), help them narrow down what they actually want before downloading.
- Prefer EPUB over other formats unless the user specifies otherwise. EPUB has the widest e-reader compatibility.
- If running commands on a remote server via SSH, all curl/download commands must run on that server, not locally.
