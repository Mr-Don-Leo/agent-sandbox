/// Egress proxy for allowlist network mode.
///
/// The sandbox container sits on an internal (no-egress) Docker network; the
/// only way out is this HTTP/HTTPS CONNECT proxy, which runs in a sidecar
/// container attached to both the internal network and the default bridge and
/// refuses any host not on the allowlist.
pub const PROXY_PORT: u16 = 3128;

/// Image used for the proxy sidecar; only needs a Python interpreter.
pub const PROXY_IMAGE: &str = "python:3.12-alpine";

/// True if `host` is covered by `allowed`: exact match, or a subdomain of an
/// allowed suffix (allowing `github.com` also allows `api.github.com`).
pub fn host_allowed(host: &str, allowed: &[String]) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    allowed.iter().any(|entry| {
        let entry = entry.trim_end_matches('.').to_ascii_lowercase();
        host == entry || host.ends_with(&format!(".{entry}"))
    })
}

/// Render the Python proxy program with the allowlist baked in.
pub fn proxy_program(allowed_hosts: &[String]) -> String {
    let hosts_json = serde_json::to_string(
        &allowed_hosts
            .iter()
            .map(|h| h.trim_end_matches('.').to_ascii_lowercase())
            .collect::<Vec<_>>(),
    )
    .expect("serializing a list of strings cannot fail");

    // Filtering logic must stay in sync with `host_allowed` above.
    format!(
        r#"import json, socket, socketserver, threading

ALLOWED = json.loads('{hosts_json}')
PORT = {port}

def allowed(host):
    host = host.rstrip('.').lower()
    return any(host == a or host.endswith('.' + a) for a in ALLOWED)

def pump(src, dst):
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except OSError:
            pass

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            head = b''
            while b'\r\n\r\n' not in head and len(head) < 65536:
                chunk = self.request.recv(4096)
                if not chunk:
                    return
                head += chunk
            line = head.split(b'\r\n', 1)[0].decode('latin-1')
            method, target, _ = line.split(' ', 2)
            if method != 'CONNECT':
                self.request.sendall(b'HTTP/1.1 405 Method Not Allowed\r\n\r\n')
                return
            host, _, port = target.partition(':')
            if not allowed(host):
                self.request.sendall(b'HTTP/1.1 403 Forbidden by sandbox policy\r\n\r\n')
                return
            upstream = socket.create_connection((host, int(port or 443)), timeout=15)
            self.request.sendall(b'HTTP/1.1 200 Connection Established\r\n\r\n')
            t = threading.Thread(target=pump, args=(self.request, upstream), daemon=True)
            t.start()
            pump(upstream, self.request)
            t.join()
        except Exception:
            try:
                self.request.sendall(b'HTTP/1.1 502 Bad Gateway\r\n\r\n')
            except OSError:
                pass

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

print('agentsandbox proxy on', PORT, 'allowing', ALLOWED, flush=True)
Server(('0.0.0.0', PORT), Handler).serve_forever()
"#,
        port = PROXY_PORT,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn exact_and_subdomain_hosts_are_allowed() {
        let allowed = strings(&["github.com", "registry.npmjs.org"]);
        assert!(host_allowed("github.com", &allowed));
        assert!(host_allowed("api.github.com", &allowed));
        assert!(host_allowed("GITHUB.COM", &allowed));
        assert!(host_allowed("registry.npmjs.org", &allowed));
    }

    #[test]
    fn lookalike_and_unlisted_hosts_are_refused() {
        let allowed = strings(&["github.com"]);
        assert!(!host_allowed("evilgithub.com", &allowed));
        assert!(!host_allowed("github.com.evil.io", &allowed));
        assert!(!host_allowed("example.com", &allowed));
        assert!(!host_allowed("github.com", &[]));
    }

    #[test]
    fn proxy_program_embeds_normalized_allowlist() {
        let program = proxy_program(&strings(&["GitHub.com."]));
        assert!(program.contains(r#"["github.com"]"#));
        assert!(program.contains("CONNECT"));
        assert!(program.contains("3128"));
    }
}
