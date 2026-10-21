"""Executável portátil: sobe a API + interface localmente e abre o navegador.

Os dados ficam na pasta "EstoqueIdealization-dados" ao lado do executável (portátil: dá para
levar num pendrive). Um arquivo .env ao lado do executável é lido (ex.: ANTHROPIC_API_KEY).

Opções:
  --demo   cria dados de demonstração no primeiro uso
  --lan    aceita acessos de outros aparelhos da rede (ex.: celular no mesmo Wi-Fi)
  --port N porta preferida (padrão 8765)
"""

from __future__ import annotations

import argparse
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

APP_NAME = "Estoque Idealization"
DEFAULT_PORT = 8765


def base_dirs() -> tuple[Path, Path]:
    """(pasta do executável, pasta dos recursos empacotados)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent, Path(sys._MEIPASS)  # type: ignore[attr-defined]
    root = Path(__file__).resolve().parents[1]
    return root / "desktop", root


def data_dir(exe_dir: Path) -> Path:
    preferred = exe_dir / "EstoqueIdealization-dados"
    try:
        preferred.mkdir(exist_ok=True)
        probe = preferred / ".write-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return preferred
    except OSError:  # pasta sem permissão de escrita (ex.: Arquivos de Programas)
        fallback = (
            Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".local" / "share")
            / "EstoqueIdealization"
        )
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


def health(url: str, timeout: float = 1.0) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/api/v1/health", timeout=timeout) as response:
            return response.status == 200
    except OSError:
        return False


def free_port(preferred: int, host: str) -> int:
    for port in [preferred, *range(preferred + 1, preferred + 20)]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                return port
    with socket.socket() as sock:
        sock.bind((host, 0))
        return sock.getsockname()[1]


def lan_ip() -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        try:
            sock.connect(("10.255.255.255", 1))
            return sock.getsockname()[0]
        except OSError:
            return "127.0.0.1"


def main() -> None:
    parser = argparse.ArgumentParser(prog="EstoqueIdealization", description=APP_NAME)
    parser.add_argument(
        "--demo", action="store_true", help="gera dados de demonstração no primeiro uso"
    )
    parser.add_argument(
        "--lan", action="store_true", help="permite acesso de outros aparelhos da rede"
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true", help="não abre o navegador")
    args = parser.parse_args()
    if sys.stdout is not None:  # mostra o banner na hora, mesmo com a saída redirecionada
        sys.stdout.reconfigure(line_buffering=True)  # type: ignore[union-attr]

    exe_dir, bundle_dir = base_dirs()
    os.chdir(exe_dir)  # o .env ao lado do executável é lido pelas configurações

    # Já está aberto? Só abre o navegador de novo.
    existing = f"http://127.0.0.1:{args.port}"
    if health(existing):
        print(f"{APP_NAME} já está em execução. Abrindo {existing}")
        webbrowser.open(existing)
        return

    host = "0.0.0.0" if args.lan else "127.0.0.1"
    port = free_port(args.port, host)
    data = data_dir(exe_dir)
    os.environ.setdefault("ENVIRONMENT", "desktop")
    os.environ.setdefault("DATA_DIR", str(data))
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{(data / 'estoque.db').as_posix()}")
    os.environ.setdefault("FRONTEND_DIST", str(bundle_dir / "frontend_dist"))
    if args.demo:
        os.environ["DEMO_MODE"] = "true"

    # Só importa a aplicação depois de configurar o ambiente.
    import uvicorn

    from app.main import app

    url = f"http://127.0.0.1:{port}"
    print("=" * 64)
    print(f"  {APP_NAME} 2.0")
    print(f"  Endereço: {url}")
    if args.lan:
        print(f"  Na rede local: http://{lan_ip()}:{port}")
    print(f"  Dados em: {data}")
    print("  Feche esta janela (ou Ctrl+C) para encerrar.")
    print("=" * 64)

    def open_when_ready() -> None:
        for _ in range(240):  # o primeiro uso com --demo leva alguns segundos
            if health(url):
                if not args.no_browser:
                    webbrowser.open(url)
                print("Pronto! O sistema foi aberto no navegador.")
                return
            time.sleep(0.5)

    threading.Thread(target=open_when_ready, daemon=True).start()
    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
