#!/usr/bin/env python3
"""
Snippets Local — Launcher
Starts a local code editor with live preview and LLM-powered AI tools.
Uses MLX for on-device inference on Apple Silicon.
"""

import argparse
import asyncio
import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEFAULT_MODEL = "mlx-community/Llama-3.2-3B-Instruct-4bit"
DEFAULT_PORT = 3000
DEFAULT_MLX_PORT = 8080
REQUIRED_PACKAGES = ["mlx_lm", "aiohttp", "huggingface_hub"]
HTML_FILE = "snippets-local.html"

# ---------------------------------------------------------------------------
# Dependency management
# ---------------------------------------------------------------------------

def check_package(pkg: str) -> bool:
    try:
        __import__(pkg)
        return True
    except ImportError:
        return False


def install_packages(packages: list[str]) -> None:
    missing = [p for p in packages if not check_package(p)]
    if not missing:
        return
    pip_names = [p.replace("_", "-") for p in missing]
    print(f"Installing missing packages: {', '.join(pip_names)}")
    cmd = [sys.executable, "-m", "pip", "install", "--break-system-packages"] + pip_names
    try:
        subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError:
        # Retry without --break-system-packages (venv)
        cmd = [sys.executable, "-m", "pip", "install"] + pip_names
        subprocess.check_call(cmd)


def ensure_dependencies() -> bool:
    missing = [p for p in REQUIRED_PACKAGES if not check_package(p)]
    if missing:
        try:
            install_packages(missing)
        except Exception as e:
            print(f"Failed to install dependencies: {e}")
            return False
    return all(check_package(p) for p in REQUIRED_PACKAGES)


# ---------------------------------------------------------------------------
# Model management
# ---------------------------------------------------------------------------

def get_model_cache_path(model_id: str) -> Path | None:
    """Check if a model is cached locally."""
    from huggingface_hub import scan_cache_dir
    try:
        cache_info = scan_cache_dir()
        for repo in cache_info.repos:
            if repo.repo_id == model_id:
                # Find the latest revision snapshot
                for rev in repo.revisions:
                    return Path(rev.snapshot_path)
    except Exception:
        pass
    return None


def get_model_size(path: Path | None) -> int:
    if path is None or not path.exists():
        return 0
    total = 0
    for f in path.rglob("*"):
        if f.is_file():
            total += f.stat().st_size
    return total


def download_model(model_id: str) -> Path:
    from huggingface_hub import snapshot_download
    print(f"Downloading model: {model_id}")
    print("This may take a few minutes on first run...")
    path = snapshot_download(repo_id=model_id)
    print(f"Model downloaded to: {path}")
    return Path(path)


def model_status(model_id: str) -> dict:
    path = get_model_cache_path(model_id)
    if path and path.exists():
        size = get_model_size(path)
        return {
            "status": "downloaded",
            "model_id": model_id,
            "size_bytes": size,
            "path": str(path),
        }
    return {
        "status": "not_found",
        "model_id": model_id,
        "size_bytes": 0,
        "path": None,
    }


# ---------------------------------------------------------------------------
# Port helpers
# ---------------------------------------------------------------------------

def is_port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def wait_for_server(port: int, timeout: float = 30.0) -> bool:
    """Wait until a server is accepting connections on the given port."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except (ConnectionRefusedError, OSError):
            time.sleep(0.5)
    return False


# ---------------------------------------------------------------------------
# MLX server subprocess
# ---------------------------------------------------------------------------

class MLXServer:
    def __init__(self, model_id: str, port: int):
        self.model_id = model_id
        self.port = port
        self.process: subprocess.Popen | None = None

    def start(self) -> bool:
        model_path = get_model_cache_path(self.model_id)
        if model_path is None:
            print("Model not found in cache. Downloading...")
            download_model(self.model_id)
            model_path = get_model_cache_path(self.model_id)
        if model_path is None:
            print("ERROR: Could not locate model after download.")
            return False

        print(f"Starting MLX server on port {self.port}...")
        self.process = subprocess.Popen(
            [
                sys.executable, "-m", "mlx_lm.server",
                "--model", str(model_path),
                "--port", str(self.port),
                "--max-tokens", "4096",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        if wait_for_server(self.port, timeout=30):
            print(f"MLX server ready on port {self.port}")
            return True
        else:
            print("WARNING: MLX server did not respond within 30s.")
            print("It may still be loading the model. AI features will activate once ready.")
            return True  # Don't block — the server may just be slow

    def stop(self):
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
            self.process = None


# ---------------------------------------------------------------------------
# HTTP server (aiohttp)
# ---------------------------------------------------------------------------

async def run_http_server(port: int, mlx_port: int, model_id: str, html_path: Path):
    import aiohttp
    from aiohttp import web, ClientSession

    async def serve_html(request):
        return web.FileResponse(html_path)

    async def api_model_status(request):
        status = model_status(model_id)
        return web.json_response(status)

    async def api_download_model(request):
        data = await request.json()
        req_model = data.get("model_id", model_id)

        response = web.StreamResponse()
        response.content_type = "text/event-stream"
        response.headers["Cache-Control"] = "no-cache"
        await response.prepare(request)

        try:
            download_model(req_model)
            event = json.dumps({"status": "downloaded", "model_id": req_model})
            await response.write(f"data: {event}\n\n".encode())
        except Exception as e:
            event = json.dumps({"status": "error", "error": str(e)})
            await response.write(f"data: {event}\n\n".encode())

        return response

    async def proxy_to_mlx(request: web.Request):
        path = request.match_info.get("path", "")
        target = f"http://127.0.0.1:{mlx_port}/v1/{path}"

        body = await request.read()
        headers = {
            "Content-Type": request.content_type or "application/json",
        }

        # Check if streaming is requested
        is_stream = False
        if body:
            try:
                req_json = json.loads(body)
                is_stream = req_json.get("stream", False)
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass

        async with ClientSession() as session:
            try:
                async with session.request(
                    request.method, target,
                    data=body, headers=headers,
                    timeout=aiohttp.ClientTimeout(total=120),
                ) as resp:
                    if is_stream:
                        response = web.StreamResponse()
                        response.content_type = "text/event-stream"
                        response.headers["Cache-Control"] = "no-cache"
                        await response.prepare(request)
                        async for chunk in resp.content.iter_any():
                            await response.write(chunk)
                        return response
                    else:
                        data = await resp.read()
                        return web.Response(
                            body=data,
                            status=resp.status,
                            content_type=resp.content_type,
                        )
            except Exception as e:
                return web.json_response(
                    {"error": f"MLX server error: {str(e)}"},
                    status=502,
                )

    app = web.Application()
    app.router.add_get("/", serve_html)
    app.router.add_get("/api/model-status", api_model_status)
    app.router.add_post("/api/download-model", api_download_model)
    app.router.add_route("*", "/v1/{path:.*}", proxy_to_mlx)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", port)
    await site.start()
    return runner


# ---------------------------------------------------------------------------
# --check mode
# ---------------------------------------------------------------------------

def run_check(model_id: str, port: int, mlx_port: int):
    print("=== Snippets Local Health Check ===\n")

    # Dependencies
    all_ok = True
    for pkg in REQUIRED_PACKAGES:
        ok = check_package(pkg)
        status = "OK" if ok else "MISSING"
        print(f"  {pkg}: {status}")
        if not ok:
            all_ok = False

    # Model
    ms = model_status(model_id)
    size_mb = ms["size_bytes"] / (1024 * 1024) if ms["size_bytes"] else 0
    print(f"\n  Model: {model_id}")
    print(f"  Status: {ms['status']} ({size_mb:.0f} MB)")

    # Ports
    p1 = is_port_available(port)
    p2 = is_port_available(mlx_port)
    print(f"\n  Port {port}: {'available' if p1 else 'IN USE'}")
    print(f"  Port {mlx_port}: {'available' if p2 else 'IN USE'}")

    # HTML file
    html = Path(__file__).parent / HTML_FILE
    print(f"\n  {HTML_FILE}: {'found' if html.exists() else 'MISSING'}")

    if all_ok and ms["status"] == "downloaded" and p1 and p2 and html.exists():
        print("\n All checks passed.")
        return 0
    else:
        print("\n Some checks failed.")
        return 1


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def print_banner(model_id: str, port: int, mlx_port: int, model_cached: bool):
    size_info = ""
    if model_cached:
        ms = model_status(model_id)
        size_mb = ms["size_bytes"] / (1024 * 1024)
        size_info = f"Cached ({size_mb:.1f} MB)"
    else:
        size_info = "Downloading..."

    print()
    print("=" * 52)
    print("  Snippets Local")
    print("=" * 52)
    print(f"  Model:      {model_id}")
    print(f"  Status:     {size_info}")
    print(f"  MLX Server: http://localhost:{mlx_port}")
    print(f"  Editor:     http://localhost:{port}")
    print("-" * 52)
    print("  Press Ctrl+C to stop")
    print("=" * 52)
    print()


def open_browser(port: int):
    import webbrowser
    webbrowser.open(f"http://localhost:{port}")


def main():
    parser = argparse.ArgumentParser(description="Snippets Local — code editor with local AI")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="HuggingFace model repo ID")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="HTTP server port")
    parser.add_argument("--mlx-port", type=int, default=DEFAULT_MLX_PORT, help="MLX server port")
    parser.add_argument("--check", action="store_true", help="Run health check and exit")
    parser.add_argument("--no-browser", action="store_true", help="Don't auto-open browser")
    args = parser.parse_args()

    # Ensure dependencies
    if not ensure_dependencies():
        print("ERROR: Could not install required packages.")
        print("Try: pip install mlx-lm aiohttp huggingface-hub")
        sys.exit(1)

    # --check mode
    if args.check:
        sys.exit(run_check(args.model, args.port, args.mlx_port))

    # Verify HTML file exists
    html_path = Path(__file__).parent / HTML_FILE
    if not html_path.exists():
        print(f"ERROR: {HTML_FILE} not found in {html_path.parent}")
        sys.exit(1)

    # Check ports
    if not is_port_available(args.port):
        print(f"ERROR: Port {args.port} is already in use.")
        print(f"Try: python3 {sys.argv[0]} --port {args.port + 1}")
        sys.exit(1)
    if not is_port_available(args.mlx_port):
        print(f"ERROR: Port {args.mlx_port} is already in use.")
        print(f"Try: python3 {sys.argv[0]} --mlx-port {args.mlx_port + 1}")
        sys.exit(1)

    # Check model cache
    model_cached = get_model_cache_path(args.model) is not None

    # Print banner
    print_banner(args.model, args.port, args.mlx_port, model_cached)

    # Start MLX server
    mlx = MLXServer(args.model, args.mlx_port)
    if not mlx.start():
        print("ERROR: Failed to start MLX server.")
        sys.exit(1)

    # Handle shutdown
    def shutdown(signum, frame):
        print("\nShutting down...")
        mlx.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Start HTTP server and open browser
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        runner = loop.run_until_complete(
            run_http_server(args.port, args.mlx_port, args.model, html_path)
        )
        print(f"Editor ready at http://localhost:{args.port}")

        if not args.no_browser:
            open_browser(args.port)

        loop.run_forever()
    except KeyboardInterrupt:
        pass
    finally:
        mlx.stop()
        loop.run_until_complete(runner.cleanup())
        loop.close()
        print("Goodbye.")


if __name__ == "__main__":
    main()
