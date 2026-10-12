"""Start Focus Studio, preparing a private Python environment when needed."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen
import webbrowser

ROOT = Path(__file__).resolve().parent


def is_ready(port):
    try:
        with urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as response:
            return json.load(response) == {"app": "focus-studio", "status": "ok"}
    except (URLError, OSError, ValueError):
        return False


def port_available(port):
    try:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False


def environment_python():
    python = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        print("First launch: preparing your app environment…", flush=True)
        subprocess.run([sys.executable, "-m", "venv", str(ROOT / ".venv")], check=True)
    check = subprocess.run([str(python), "-c", "import flask"], capture_output=True)
    if check.returncode:
        print("Installing the app's requirements. First launch needs internet…", flush=True)
        subprocess.run([str(python), "-m", "pip", "install", "--disable-pip-version-check",
                        "-r", str(ROOT / "requirements.txt")], check=True)
    return python


def main(argv=None):
    args = argparse.ArgumentParser(description="Open your local study timer")
    args.add_argument("--no-browser", action="store_true", help="Start without opening a browser")
    options = args.parse_args(argv)
    if sys.version_info < (3, 10):
        print("Focus Studio needs Python 3.10 or newer. Install it from python.org.")
        return 1
    try:
        requested = int(os.environ.get("PORT", "5050"))
        if not 1024 <= requested <= 65535:
            raise ValueError
    except ValueError:
        print("PORT must be a whole number between 1024 and 65535.")
        return 1
    if is_ready(requested):
        url = f"http://localhost:{requested}"
        print(f"Focus Studio is already running: {url}", flush=True)
        if not options.no_browser:
            webbrowser.open(url)
        return 0
    port = next((p for p in range(requested, min(requested + 11, 65536)) if port_available(p)), None)
    if port is None:
        print("No available local port. Close another app or set PORT to a different number.")
        return 1
    if port != requested:
        print(f"Port {requested} is busy. Using port {port} instead.", flush=True)
    try:
        python = environment_python()
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"Setup could not finish: {error}\nCheck your connection and try again. See README.md for manual setup.")
        return 1
    server = subprocess.Popen([str(python), str(ROOT / "app.py")], cwd=ROOT,
                              env={**os.environ, "PORT": str(port)})
    url = f"http://localhost:{port}"
    try:
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if server.poll() is not None:
                print("The app stopped before opening. Read the error above, or see README.md.")
                return 1
            if is_ready(port):
                break
            time.sleep(.2)
        else:
            print("The app took too long to start. Please try again.")
            return 1
        print(f"\nFocus Studio is ready: {url}", flush=True)
        print("Keep this window open while you study. Press Ctrl+C here to stop the app.\n", flush=True)
        if not options.no_browser:
            webbrowser.open(url)
        return server.wait()
    except KeyboardInterrupt:
        print("\nFocus Studio stopped. Your saved study journal is safe.")
        return 0
    finally:
        if server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()


if __name__ == "__main__":
    raise SystemExit(main())
