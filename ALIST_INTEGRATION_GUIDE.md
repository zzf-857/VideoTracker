# AList WebDAV Integration Guide (Agent-Readable Specification)

This document provides system-level instructions and technical specifications for developing AList WebDAV integration within the `VideoTracker` desktop application. 

---

## 1. Protocol & Authentication Specifications

* **Protocol**: WebDAV (AList v3 implementation compliance).
* **Endpoint URL Structure**:
  * Default Format: `http://<host>:<port>/dav`
  * SSL Proxy Format: `https://<domain>/dav` (Highly recommended for production deployment to prevent credential sniffing).
* **Authentication Method**: HTTP Basic Authentication.
  * Header requirement: `Authorization: Basic <Base64(username:password)>`
* **Path Resolution**: 
  * Path mappings are absolute from the AList root.
  * Example: A file located at `/123网盘/Movies/movie.mp4` on AList translates to WebDAV path `<endpoint>/123网盘/Movies/movie.mp4`. Ensure proper URL encoding for Chinese characters and spaces.

---

## 2. Network & Firewall Constraints

* **Port Availability**: Direct access to AList default port `5244` may be blocked by server firewalls. The application must support connecting through reverse proxy paths (e.g., `/dav` mapped to port 80/443).
* **Strict SSL/TLS**: Ensure the HTTP client library accepts HTTPS connections and parses custom domain certificates correctly when connecting over port 443.

---

## 3. Crucial Stream Handling: The HTTP 302 Redirect Trap (Critical)

Unlike traditional local file systems, AList WebDAV behaves virtualized. 
* **Behavior**: When the video player requests a file stream (via HTTP `GET`), AList does NOT download and proxy the file bytes by default. Instead, it responds with an **`HTTP 302 Found`** redirecting the client to the underlying cloud drive's temporary CDN download URL (e.g., `https://*.123pan.cn/...`).
* **Implementation Requirements for Developer Agent**:
  1. **Follow Redirects**: The media player core (or underlying HTTP client) **MUST** be configured to automatically follow HTTP redirects (302/307).
  2. **Referer Suppression (Prevent HTTP 403)**:
     * Many cloud drive CDNs (especially 123pan and AliyunDrive) enforce strict **Referer Hotlinking Prevention**.
     * If the client follows the 302 redirect while retaining the original AList host header in the `Referer` (e.g., `Referer: https://blog.zengxiansheng.top`), the CDN will block the stream and return an **`HTTP 403 Forbidden`** error.
     * **Action**: Configure your HTTP client/Player backend to **drop the `Referer` header** or use a `no-referrer` policy when following the redirect to a different domain host.

---

## 4. API Endpoints & Actions to Implement

To build a fully functional video tracker/browser interface, implement the following WebDAV operations:

### A. List Directories & Files (Library Browsing)
* **HTTP Method**: `PROPFIND`
* **Headers**: 
  * `Depth: 1`
  * `Content-Type: application/xml; charset="utf-8"`
* **Payload**: XML structure querying basic properties (`displayname`, `getcontentlength`, `resourcetype`, `getlastmodified`).
* **Parsing Action**: Parse the XML response (`multistatus`) to index sub-folders and video files.

### B. Video Stream Playback
* **HTTP Method**: `GET`
* **Headers**: Support HTTP Range requests (`Range: bytes=start-end`). This is mandatory for video players to support seeking/scrubbing within AList streams.
* **Buffer Management**: Ensure read timeouts are relaxed (e.g., >30s) to handle cloud storage initialization latency.

### C. File Existence Check
* **HTTP Method**: `HEAD`
* **Purpose**: Inspect if the video metadata file or stream link is still valid.

---

## 5. Security & User UX Guidelines

* **Restricted Accounts**: Do not prompt users to enter their master AList `admin` credentials in the app settings. 
* **User Warning**: Add an in-app notice prompting users to create a **Read-Only / Path-Restricted** user account within the AList admin panel (e.g., restricting access solely to the `/Movies` sub-path and removing write/delete privileges) for integration use.
